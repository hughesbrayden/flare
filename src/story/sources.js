// Every statistic on the site comes from this list (verified evidence, E1-E13).
// `short` is the inline citation; `full` and `url` appear in the sources list.
export const SOURCES = {
  E1: {
    short: 'FDNY testimony to NYC Council, 2022',
    full: 'FDNY testimony to the New York City Council, April 6, 2022; NYC Executive Order 12 (2022).',
    url: 'https://legistar.council.nyc.gov/View.ashx?GUID=9DFBC4AB-0B82-44E0-A836-91CD52CD7518&ID=10817061&M=F',
    url2: 'https://www.nyc.gov/assets/home/downloads/pdf/executive-orders/2022/eo-12.pdf',
  },
  E2: {
    short: 'UL FSRI, 2020',
    full: 'UL Fire Safety Research Institute, Analysis of the Coordination of Suppression and Ventilation in Multi-Family Dwellings (2020).',
    url: 'https://fsri.org/research-update/technical-report-released-multi-family-dwellings-experiments',
  },
  E3: {
    short: 'FDNY Firefighting Procedures, 2025',
    full: 'FDNY Firefighting Procedures, High Rise Fireproof Multiple Dwellings (2025), in the probationary firefighter manual.',
    url: 'https://www.nyc.gov/assets/fdny/downloads/pdf/join/probationary-firefighter-v2.pdf',
  },
  E4: {
    short: 'NCDOT / ECU RP2024-04, 2025',
    full: 'NCDOT / East Carolina University, RP2024-04 (2025). 81-firefighter study rating navigable 3D imagery vs. 2D plans for understanding navigation (ratings, not task performance).',
    url: 'https://connect.ncdot.gov/projects/research/RNAProjDocs/Final%20Report_RP2024-04.pdf',
  },
  E5: {
    short: 'OGC 18-089, 2019',
    full: 'Open Geospatial Consortium, Indoor Mapping and Navigation Pilot Engineering Report (OGC 18-089), sponsored by NIST’s public safety program, 2019.',
    url: 'https://docs.ogc.org/per/18-089.html',
  },
  E6: {
    short: 'NFPA 1710, via DC Fire & EMS',
    full: 'NFPA 1710 response-time objectives (now part of NFPA 1750), as published by DC Fire & EMS. The standard itself is paywalled.',
    url: 'https://fems.dc.gov/page/fire-response-time',
  },
  E7: {
    short: 'Kerber, Fire Technology, 2012',
    full: 'S. Kerber, Analysis of Changing Residential Fire Dynamics and Its Implications on Firefighter Operational Timeframes, Fire Technology (2012).',
    url: 'https://technicalpanels.fsri.org/docs/Analysis_of_Changing_Residential_Fire_Dynamics_and_Its_Implications_on_Firefighter_Operational_Timeframes.pdf',
  },
  E8: {
    short: 'NIOSH report F2025-02',
    full: 'NIOSH Fire Fighter Fatality Investigation F2025-02 (Hawaii, January 2025).',
    url: 'https://www.cdc.gov/niosh/firefighters/programs/pdfs/face202502RS.pdf',
  },
  E9: {
    short: 'Firehouse, 2016 (preliminary data)',
    full: 'Firehouse, “The Mayday Project” (2016). Early, preliminary data reported in the trade press.',
    url: 'https://www.firehouse.com/home/article/12156553/the-mayday-project',
  },
  E10: {
    short: 'USFA, 2017–2019 data',
    full: 'U.S. Fire Administration, Civilian Fire Fatalities in Residential Buildings (2017–2019).',
    url: 'https://www.usfa.fema.gov/statistics/reports/who-fire-impacts/civilian-fire-fatalities-residential-buildings-v21i3.html',
  },
  E11: {
    short: 'NFPA / USFA, 2021 data',
    full: 'NFPA, Fire Loss in the United States During 2021; U.S. Fire Administration.',
    url: 'https://www.usfa.fema.gov/downloads/pdf/statistics/v21i6.pdf',
  },
  E12: {
    short: 'Fire Engineering, 2001; OGC 18-089',
    full: 'Fire Engineering, “Residential Pre-Incident Intelligence” (2001); OGC 18-089 (2019). A practitioner observation, not a standard.',
    url: 'https://www.fireengineering.com/firefighting/residential-preincident-intelligence/',
  },
  E13: {
    short: 'Our test, 3 real plans',
    full: 'Our own test: three real floor plans, scored against answer keys we made by hand.',
    url: null,
  },
};

export const SOURCE_ORDER = ['E10', 'E7', 'E6', 'E1', 'E2', 'E3', 'E8', 'E9', 'E11', 'E12', 'E5', 'E4', 'E13'];
