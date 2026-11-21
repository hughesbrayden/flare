"""Thin client over the Gemini Interactions API (Managed Agents), plus a mock.

Live flow per task (per the Managed Agents docs, Nov 2026):
  client.interactions.create(agent=..., input=[text, image parts], environment={type: remote,
      sources: [inline files]}, agent_config={type: antigravity, max_total_tokens}, background=True)
  -> poll client.interactions.get(id) until a terminal status
  -> read interaction.output_text and interaction.usage
Follow-up turns (bad-JSON retry, checker send-back) continue the same conversation and
sandbox with previous_interaction_id + environment=<environment_id>.

The API key is read from GEMINI_API_KEY or <pipeline>/.env and is never printed or logged.
"""
import base64
import os
import random
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import config

TERMINAL_OK = {"completed", "idle"}
TERMINAL_BAD = {"failed", "cancelled", "incomplete", "budget_exceeded", "requires_action", "requires_continuation"}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class AgentTask:
    name: str                 # e.g. "reader:A-4"
    role: str                 # reader | stitcher | checker | dispatch | investigator
    prompt: str
    images: list = field(default_factory=list)    # [(label, png_bytes)]
    sources: list = field(default_factory=list)   # [(target_path, text_content)]
    previous: tuple = None    # (interaction_id, environment_id) to continue a conversation
    meta: dict = field(default_factory=dict)      # used by the mock only
    mode: str = "agent"       # "agent" (Managed Agent sandbox) | "model" (plain Interactions call)
    model: str = None         # override model for mode="model"
    thinking_level: str = None
    image_resolution: str = None
    response_format: dict = None


@dataclass
class AgentResult:
    name: str
    status: str
    text: str = ""
    interaction_id: str = None
    environment_id: str = None
    usage: dict = field(default_factory=dict)
    cost_usd: float = 0.0
    started: str = None
    ended: str = None
    seconds: float = 0.0
    error: str = None


def estimate_cost(usage):
    p = config.PRICE_PER_M
    inp = (usage.get("total_input_tokens") or 0) + (usage.get("total_tool_use_tokens") or 0)
    cached = usage.get("total_cached_tokens") or 0
    out = (usage.get("total_output_tokens") or 0) + (usage.get("total_thought_tokens") or 0)
    return round((max(inp - cached, 0) * p["input"] + cached * p["cached_input"] + out * p["output"]) / 1e6, 4)


def load_api_key():
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key.strip()
    candidates = [
        os.path.join(config.PIPELINE_ROOT, ".env"),
        config.EXTERNAL_DOTENV_PATH,
    ]
    for path in candidates:
        if path and os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line.startswith("GEMINI_API_KEY="):
                        val = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if val:
                            return val
    return None


class Redactor:
    """Removes the key from any text before it is logged or written."""
    def __init__(self, secret):
        self.secret = secret

    def __call__(self, text):
        text = "" if text is None else str(text)
        return text.replace(self.secret, "[REDACTED]") if self.secret else text


class LiveClient:
    mode = "live"

    def __init__(self):
        key = load_api_key()
        if not key:
            raise RuntimeError("No GEMINI_API_KEY in the environment or in .env")
        from google import genai
        self.redact = Redactor(key)
        self.client = genai.Client(api_key=key, http_options={"api_version": config.API_VERSION})
        self._lock = threading.Lock()

    def _input(self, task):
        parts = [{"type": "text", "text": task.prompt}]
        for label, png in task.images:
            parts.append({"type": "text", "text": f"Image: sheet {label}"})
            img = {"type": "image", "data": base64.b64encode(png).decode("ascii"), "mime_type": "image/png"}
            if task.image_resolution:
                img["resolution"] = task.image_resolution
            parts.append(img)
        return parts

    def run(self, task, log=print):
        res = AgentResult(name=task.name, status="starting", started=now_iso())
        t0 = time.time()
        try:
            if task.mode == "model":
                kwargs = dict(model=task.model or config.FAST_MODEL, input=self._input(task))
                if task.thinking_level:
                    kwargs["generation_config"] = {"thinking_level": task.thinking_level}
                if task.response_format:
                    kwargs["response_format"] = task.response_format
                if task.previous:
                    kwargs["previous_interaction_id"] = task.previous[0]
                try:
                    inter = self.client.interactions.create(**kwargs)
                except Exception:
                    # Fallback if response_format without full schema is rejected on a model call
                    if "response_format" in kwargs and "schema" not in (kwargs["response_format"] or {}):
                        kwargs.pop("response_format", None)
                        inter = self.client.interactions.create(**kwargs)
                    else:
                        raise
                res.interaction_id = getattr(inter, "id", None)
                status = getattr(inter, "status", None) or "completed"
            else:
                kwargs = dict(agent=config.AGENT_NAME, input=self._input(task), background=True,
                              agent_config={"type": "antigravity",
                                            "max_total_tokens": config.TOKEN_CAP.get(task.role, 1_500_000)})
                if task.previous:
                    kwargs["previous_interaction_id"] = task.previous[0]
                    kwargs["environment"] = task.previous[1]
                else:
                    kwargs["environment"] = {"type": "remote", "sources": [
                        {"type": "inline", "target": t, "content": c} for t, c in task.sources]}
                inter = self.client.interactions.create(**kwargs)
                res.interaction_id = getattr(inter, "id", None)
                res.environment_id = getattr(inter, "environment_id", None)
                log(f"[{task.name}] launched interaction {res.interaction_id}")
                status = getattr(inter, "status", None)
                while status not in TERMINAL_OK | TERMINAL_BAD:
                    if time.time() - t0 > config.TASK_TIMEOUT_SECONDS:
                        try:
                            self.client.interactions.cancel(id=res.interaction_id)
                        except Exception:
                            pass
                        raise TimeoutError(f"timed out after {config.TASK_TIMEOUT_SECONDS}s (last status {status})")
                    time.sleep(config.POLL_SECONDS)
                    inter = self.client.interactions.get(res.interaction_id)
                    status = getattr(inter, "status", None)
            res.status = status
            res.environment_id = getattr(inter, "environment_id", None) or res.environment_id
            res.text = getattr(inter, "output_text", None) or _text_from_steps(inter)
            u = getattr(inter, "usage", None)
            res.usage = {k: v for k, v in (u.model_dump() if u is not None else {}).items()
                         if k.startswith("total_") or k == "initial_input_tokens"}
            res.cost_usd = estimate_cost(res.usage)
            errs = getattr(inter, "errors", None)
            if status not in TERMINAL_OK:
                res.error = self.redact(f"status={status}; errors={errs}")
        except Exception as e:  # noqa: BLE001 - every failure is reported, redacted
            res.status = "error"
            res.error = self.redact(f"{type(e).__name__}: {e}")
        res.ended = now_iso(); res.seconds = round(time.time() - t0, 1)
        log(f"[{task.name}] {res.status} in {res.seconds}s, tokens={res.usage.get('total_tokens')}, est ${res.cost_usd}"
            + (f" ERROR {res.error}" if res.error else ""))
        return res

    def download(self, environment_id, path):
        try:
            return self.client.environments.files.download(environment=environment_id, path=path)
        except Exception:
            return None


def _text_from_steps(inter):
    """Fallback when output_text is empty: last text found in the dumped steps."""
    try:
        dump = inter.model_dump()
    except Exception:
        return ""
    texts = []
    def walk(x):
        if isinstance(x, dict):
            if x.get("type") == "text" and isinstance(x.get("text"), str):
                texts.append(x["text"])
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(dump.get("steps") or [])
    return texts[-1] if texts else ""


class MockClient:
    """Returns canned, plausible agent replies. Every result is labeled mock."""
    mode = "mock"

    def __init__(self, seed=7):
        from . import mock_agents
        self.agents = mock_agents
        self.rng = random.Random(seed)
        self.redact = Redactor(None)
        self._n = 0
        self._lock = threading.Lock()

    def run(self, task, log=print):
        with self._lock:
            self._n += 1
            n = self._n
            delay = self.rng.uniform(0.3, 1.2)
            inp = self.rng.randint(180_000, 420_000)
        res = AgentResult(name=task.name, status="in_progress", started=now_iso())
        t0 = time.time()
        time.sleep(delay)
        if task.role == "dispatch":
            import json as _json
            res.text = _json.dumps({
                "target_space_id": "f4-apt-4c",
                "reports": [
                    {"space_id": "f4-apt-4c", "kind": "smoke", "text": "smoke showing from apartment 4C"},
                    {"space_id": "f4-east-lobby", "kind": "smoke", "text": "heavy smoke in the fourth floor east lobby"},
                ],
            })
        else:
            res.text = self.agents.respond(task)
        res.status = "completed"
        res.interaction_id = f"mock-interaction-{n:03d}"
        res.environment_id = task.previous[1] if task.previous else f"mock-env-{n:03d}"
        cached = int(inp * 0.6); out = inp // 12
        res.usage = {"total_input_tokens": inp, "total_cached_tokens": cached, "total_output_tokens": out,
                     "total_thought_tokens": out // 2, "total_tool_use_tokens": 0,
                     "total_tokens": inp + out + out // 2}
        res.cost_usd = estimate_cost(res.usage)
        res.ended = now_iso(); res.seconds = round(time.time() - t0, 1)
        log(f"[{task.name}] MOCK {res.status} in {res.seconds}s")
        return res

    def download(self, environment_id, path):
        return None
