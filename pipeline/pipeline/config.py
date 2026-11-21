"""Paths, agent settings and pricing constants for the Track B pipeline."""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE_ROOT = os.path.dirname(HERE)                      # pipeline/
REPO_ROOT = os.path.dirname(PIPELINE_ROOT)                 # repo root (pipeline/ sits next to data/)
DATA_DIR = os.path.join(REPO_ROOT, "data", "marlowe")
SHEETS_DIR = os.path.join(DATA_DIR, "sheets")
# Read ONLY by scorer.py. Never passed to any agent.
TRUE_MODEL_PATH = os.path.join(DATA_DIR, "true_model.json")

PROMPTS_DIR = os.path.join(PIPELINE_ROOT, "prompts")
EVAL_DIR = os.path.join(PIPELINE_ROOT, "eval")
MOCK_EVAL_DIR = os.path.join(EVAL_DIR, "mock")
LOG_DIR = os.path.join(PIPELINE_ROOT, "logs")
# Optional key file kept outside the repo: set FLARE_ENV_FILE to its path.
EXTERNAL_DOTENV_PATH = os.environ.get("FLARE_ENV_FILE", "")

SHEET_IDS = ["A-1", "A-2", "A-4", "A-301"]
SHEET_FLOORS = {"A-1": [1], "A-2": [2, 3, 5], "A-4": [4], "A-301": []}

# Managed agent (Interactions API). Name from the Managed Agents quickstart (Nov 2026).
AGENT_NAME = os.environ.get("TRACKB_AGENT", "antigravity-preview-09-2026")
API_VERSION = "v1beta"

# Fast-path plain-call settings (Interactions API, no sandbox).
FAST_MODEL = os.environ.get("TRACKB_FAST_MODEL", "gemini-4-hydrogen")
FAST_READER_THINKING = os.environ.get("TRACKB_FAST_READER_THINKING", "low")
FAST_CHECKER_THINKING = os.environ.get("TRACKB_FAST_CHECKER_THINKING", "medium")
FAST_IMAGE_RESOLUTION = os.environ.get("TRACKB_FAST_RESOLUTION", "ultra_high")

# Per-task token caps (agent_config.max_total_tokens; best effort per the docs).
TOKEN_CAP = {"reader": 1_500_000, "stitcher": 1_200_000, "checker": 1_500_000, "investigator": 1_000_000}
# Stop launching new tasks once the estimated spend passes this.
MAX_RUN_COST_USD = float(os.environ.get("TRACKB_MAX_COST_USD", "30"))

POLL_SECONDS = 2
TASK_TIMEOUT_SECONDS = 40 * 60
MAX_FIX_PASSES = 2          # reader render-and-compare self-fix passes (instructed in prompt)
MAX_CHECK_ROUNDS = 2        # checker -> owner send-back rounds

# Pricing estimate, USD per 1M tokens (Gemini 4 Hydrogen standard tier, docs pricing page, Nov 2026).
# The Antigravity agent bills the underlying model's tokens; sandbox compute is free in preview.
PRICE_PER_M = {
    "input": 1.50,
    "cached_input": 0.075,
    "output": 7.50,   # includes thinking tokens
}
