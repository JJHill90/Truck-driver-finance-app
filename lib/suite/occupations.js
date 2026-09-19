/**
 * Common Australian occupations for Go Taxation Suite, with specialisations.
 * Travel policy follows ATO TD Tables 1–3 for ordinary employees (salary +
 * destination). Special cases: employee truck drivers (Table 5), FIFO/remote
 * regular workplace (usually private travel), airline crew rest-break overnight,
 * Remuneration Tribunal / federal MPs (Tables 1–3 do not apply), and LAFHA
 * (FBT weekly food) when living away for a period rather than hotel nights.
 *
 * Sources: TD 2025/4 / TD 2026/4, TR 2021/4, TR 2004/6, ATO Tax Time occupation
 * toolkits (sales, construction, flight attendant, nurse, teacher, miner, etc.).
 */

const TRAVEL = {
  tables13: {
    kind: "tables_1_3",
    label: "Overnight work travel (Tables 1–3)",
    determinationHint: "TD Tables 1–3 capital-city / high-cost amounts by salary band",
  },
  lafha: {
    kind: "lafha",
    label: "Living away from home (FBT food)",
    determinationHint: "TD 2025/2 / TD 2026/2 weekly food for a LAFHA fringe benefit",
  },
  fifo: {
    kind: "fifo",
    label: "FIFO / remote roster",
    determinationHint:
      "Travel between home and a regular remote workplace is usually private. Tables 1–3 apply only to temporary work travel away from that regular site.",
  },
  itinerant: {
    kind: "itinerant",
    label: "Itinerant / no regular workplace",
    determinationHint:
      "If you have no regular workplace, site-to-site travel can be work-related. Overnight hotel nights still use Tables 1–3.",
  },
  airline: {
    kind: "airline_crew",
    label: "Airline crew rest-break overnight",
    determinationHint:
      "ATO flight-attendant toolkit: overnight includes a mandatory rest of about seven hours with accommodation taken up. Employer-paid rooms are not deductible.",
  },
  truck: {
    kind: "truck_driver",
    label: "Employee truck driver meals (Table 5)",
    determinationHint:
      "TD paragraph 12: Tables 1–3 do not apply. Table 5 meals only (all domestic destinations). Driver Hub is the truck-driver product.",
  },
  tribunal: {
    kind: "tribunal",
    label: "Remuneration Tribunal / parliament",
    determinationHint:
      "TD Tables 1–3 do not apply to Remuneration Tribunal office holders or federal members of parliament.",
  },
  none: {
    kind: "none",
    label: "No typical overnight allowance",
    determinationHint: "Day commuting and same-day trips do not attract the overnight travel substantiation exception.",
  },
};

function slug(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

const HINTS = {
  office: [
    "Home office running costs or hours method (cents per hour).",
    "Union / professional association fees.",
    "Self-education that maintains or improves skills in your current role.",
    "Tax-agent fees and donations to DGR charities.",
  ],
  sales: [
    "Overnight client or territory travel uses Tables 1–3 when you sleep away from home.",
    "Living away for a posting may be a LAFHA (FBT weekly food), not a hotel travel allowance.",
    "Phone, client entertainment (limited) and home office if you work from a home base.",
  ],
  healthcare: [
    "Protective clothing, shoes and laundry for occupation-specific uniforms.",
    "Agency or rural placements that require sleeping away use Tables 1–3.",
    "Self-education and professional registrations.",
  ],
  education: [
    "Teaching aids you paid for and were not reimbursed.",
    "Overnight school camps or excursions you were required to attend.",
    "Union fees and relevant self-education.",
  ],
  construction: [
    "Protective clothing, tools and licence renewals.",
    "Itinerant site work can make travel between sites deductible.",
    "FIFO travel to a regular remote camp is usually private.",
  ],
  fifo: [
    "Flights and camp meals provided by the employer are not deductible.",
    "A travel allowance for temporary work away from the regular site uses Tables 1–3.",
    "Keep a roster and work diary to show which nights were travel vs regular site.",
  ],
  airline: [
    "Overnight rest-break meals and incidentals you paid yourself.",
    "Grooming is private; occupation-specific uniforms and laundry can be claimed.",
    "Travel between home and your usual sign-on airport is private.",
  ],
  audit: [
    "Client-site fieldwork often involves hotel nights — Tables 1–3.",
    "Professional memberships (CA ANZ, CPA, IIA) and CPD.",
    "Home office if you prepare files away from the client.",
  ],
  it: [
    "Self-education and professional memberships.",
    "Home office / work-from-home hours.",
    "Client-site or conference travel only when you sleep away for work.",
  ],
  legal: [
    "Practising certificates and professional memberships.",
    "Court circuit or interstate matters that require overnight stays.",
    "Home office and reference materials.",
  ],
  hospitality: [
    "Occupation-specific clothing and laundry.",
    "Union fees.",
    "Overnight work is uncommon unless you travel between venues for the employer.",
  ],
  retail: [
    "Compulsory uniform and laundry.",
    "Union fees.",
    "Ordinary home-to-store travel is private.",
  ],
  gov: [
    "Union fees and self-education.",
    "Regional deployments or training that require sleeping away use Tables 1–3.",
    "Remuneration Tribunal office holders do not use Tables 1–3.",
  ],
};

const GROUPS = [
  {
    group: "Accounting, audit & finance",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.audit,
    items: [
      [
        "Accountant",
        [
          "Financial accountant",
          "Management accountant",
          "Cost accountant",
          "Tax accountant",
          "Forensic accountant",
          "Project accountant",
          "Assistant accountant",
          "Graduate accountant",
        ],
      ],
      [
        "Auditor",
        [
          "Financial auditor",
          "External auditor",
          "Internal auditor",
          "Inventory auditor",
          "Stocktake auditor",
          "IT auditor",
          "Quality auditor",
          "Environmental auditor",
          "Safety auditor",
          "Payroll auditor",
        ],
        { typicalOvernight: true, hints: HINTS.audit },
      ],
      [
        "Bookkeeper",
        ["BAS agent", "Payroll officer", "Accounts payable officer", "Accounts receivable officer"],
        { hints: HINTS.office },
      ],
      ["Financial planner", ["Financial adviser", "Paraplanner", "Wealth adviser"]],
      ["Credit analyst", ["Credit controller", "Collections officer"]],
      ["Investment analyst", ["Equity analyst", "Funds manager", "Superannuation administrator"]],
      ["Bank teller", ["Personal banker", "Mobile lender", "Business banker"], { hints: HINTS.office }],
      ["Insurance broker", ["Insurance underwriter", "Claims officer", "Loss adjuster"], { typicalOvernight: true }],
      ["Actuary", ["Pricing analyst", "Superannuation actuary"]],
    ],
  },
  {
    group: "Sales, marketing & customer",
    typicalOvernight: true,
    travel: TRAVEL.tables13,
    hints: HINTS.sales,
    items: [
      [
        "Sales representative",
        [
          "Medical sales representative",
          "Pharmaceutical sales representative",
          "Agricultural sales representative",
          "Industrial sales representative",
          "IT sales representative",
          "Advertising sales representative",
          "Wholesale sales representative",
        ],
      ],
      ["Account manager", ["Key account manager", "National account manager", "Client partner"]],
      ["Business development manager", ["Partnerships manager", "Channel manager"]],
      ["Territory manager", ["Area manager", "Regional sales manager"]],
      ["Marketing coordinator", ["Digital marketer", "Content marketer", "Brand manager", "Product marketer"], { typicalOvernight: false, hints: HINTS.office }],
      ["Market researcher", ["Insights analyst"]],
      ["Call centre operator", ["Customer service officer", "Customer success manager"], { typicalOvernight: false, hints: HINTS.office }],
      ["Real estate agent", ["Buyer’s agent", "Property manager", "Leasing consultant", "Commercial real estate agent"], { typicalOvernight: false }],
    ],
  },
  {
    group: "Administration, HR & office",
    typicalOvernight: false,
    travel: TRAVEL.none,
    hints: HINTS.office,
    items: [
      ["Office administrator", ["Office manager", "Executive assistant", "Personal assistant", "Receptionist", "Administration officer"]],
      ["Human resources officer", ["HR business partner", "Recruitment consultant", "Talent acquisition specialist", "Payroll specialist", "WHS officer"]],
      ["Project coordinator", ["Project officer", "PMO analyst"]],
      ["Records officer", ["Librarian", "Archivist", "Information officer"]],
      ["Contract administrator", ["Procurement officer", "Purchasing officer"]],
    ],
  },
  {
    group: "Legal & compliance",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.legal,
    items: [
      ["Solicitor", ["Corporate solicitor", "Litigation solicitor", "Family lawyer", "Criminal lawyer", "In-house counsel"]],
      ["Barrister", ["Crown prosecutor"], { typicalOvernight: true }],
      ["Paralegal", ["Legal secretary", "Conveyancer"]],
      ["Compliance officer", ["AML officer", "Risk officer", "Company secretary"]],
      ["Migration agent", ["Visa consultant"]],
    ],
  },
  {
    group: "IT, digital & data",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.it,
    items: [
      ["Software developer", ["Frontend developer", "Backend developer", "Full stack developer", "Mobile developer", "DevOps engineer", "Site reliability engineer"]],
      ["IT support officer", ["Service desk analyst", "Systems administrator", "Network engineer", "Cyber security analyst"]],
      ["Business analyst", ["Systems analyst", "Product owner", "Scrum master"]],
      ["Data analyst", ["Data scientist", "Data engineer", "BI developer"]],
      ["UX designer", ["UI designer", "Product designer"]],
      ["IT consultant", ["SAP consultant", "Cloud consultant"], { typicalOvernight: true }],
    ],
  },
  {
    group: "Healthcare & community",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.healthcare,
    items: [
      ["Registered nurse", ["Enrolled nurse", "Nurse practitioner", "Agency nurse", "Theatre nurse", "Mental health nurse", "Aged care nurse", "Midwife"], { typicalOvernight: true }],
      ["Doctor", ["General practitioner", "Hospital resident", "Registrar", "Specialist physician", "Surgeon", "Anaesthetist", "Rural GP"], { typicalOvernight: true }],
      ["Allied health", ["Physiotherapist", "Occupational therapist", "Speech pathologist", "Dietitian", "Podiatrist", "Exercise physiologist", "Audiologist", "Psychologist", "Counsellor"]],
      ["Paramedic", ["Intensive care paramedic", "Patient transport officer"], { typicalOvernight: true }],
      ["Pharmacist", ["Hospital pharmacist", "Community pharmacist"]],
      ["Dentist", ["Dental hygienist", "Dental assistant", "Oral health therapist"]],
      ["Aged care worker", ["Personal care worker", "Disability support worker", "Community support worker"]],
      ["Medical scientist", ["Pathology collector", "Radiographer", "Sonographer"]],
      ["Veterinary surgeon", ["Vet nurse"]],
    ],
  },
  {
    group: "Education & training",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.education,
    items: [
      ["Teacher", ["Primary teacher", "Secondary teacher", "Relief teacher", "Special education teacher", "Head of department"]],
      ["Early childhood educator", ["Childcare educator", "Room leader", "Centre director"]],
      ["Teacher aide", ["Learning support officer"]],
      ["University lecturer", ["Tutor", "Research fellow", "Academic"]],
      ["TAFE teacher", ["Vocational trainer", "Workplace trainer"]],
      ["Instructional designer", ["Corporate trainer"]],
    ],
  },
  {
    group: "Construction, trades & property",
    typicalOvernight: false,
    travel: TRAVEL.itinerant,
    hints: HINTS.construction,
    items: [
      ["Builder", ["Site supervisor", "Leading hand", "Construction manager", "Foreman"], { typicalOvernight: true }],
      ["Carpenter", ["Joiner", "Formworker"]],
      ["Electrician", ["A-grade electrician", "Electrical fitter", "Linesperson"]],
      ["Plumber", ["Gasfitter", "Drainer", "Roof plumber"]],
      ["Painter", ["Decorator"]],
      ["Plasterer", ["Renderer"]],
      ["Bricklayer", ["Stonemason"]],
      ["Tiler", ["Flooring installer"]],
      ["Concreter", ["Steelfixer"]],
      ["Scaffolder", ["Rigger", "Dogman"]],
      ["Boilermaker", ["Welder", "Fitter and turner", "Machinist"]],
      ["Cabinet maker", ["Shopfitter"]],
      ["Landscaper", ["Gardener", "Arborist", "Horticulturist"]],
      ["Quantity surveyor", ["Estimator", "Contract administrator (construction)"]],
      ["Architect", ["Architectural drafter", "Interior designer", "Landscape architect"]],
      ["Town planner", ["Building surveyor", "Building inspector"]],
      ["Civil engineer", ["Structural engineer", "Site engineer", "Geotechnical engineer"], { typicalOvernight: true }],
    ],
  },
  {
    group: "Mining, energy & resources",
    typicalOvernight: true,
    travel: TRAVEL.fifo,
    hints: HINTS.fifo,
    items: [
      ["FIFO mine worker", ["DIDO operator", "Dump truck operator", "Haul truck operator", "Shotfirer", "Pit technician"]],
      ["Underground miner", ["Jumbo operator", "Bogger operator", "Longwall operator"]],
      ["Process technician", ["Plant operator", "Control room operator"]],
      ["Mine geologist", ["Exploration geologist", "Grade controller"]],
      ["Mining engineer", ["Drill and blast engineer", "Ventilation engineer"]],
      ["Metallurgist", ["Process engineer"]],
      ["Oil and gas technician", ["Derrickhand", "Roughneck", "Production technician", "Offshore technician"]],
      ["Renewable energy technician", ["Wind turbine technician", "Solar installer"]],
    ],
  },
  {
    group: "Engineering & science",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.it,
    items: [
      ["Mechanical engineer", ["Maintenance engineer", "Reliability engineer"]],
      ["Electrical engineer", ["Instrumentation engineer", "Power engineer"]],
      ["Chemical engineer", ["Process safety engineer"]],
      ["Environmental scientist", ["Environmental consultant", "Ecologist"], { typicalOvernight: true }],
      ["Laboratory technician", ["Chemist", "Food technologist"]],
      ["Surveyor", ["Land surveyor", "Mine surveyor", "Hydrographic surveyor"], { typicalOvernight: true }],
    ],
  },
  {
    group: "Transport, logistics & aviation",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.office,
    items: [
      ["Truck driver", ["Linehaul driver", "Local delivery driver", "Tanker driver", "Furniture removalist"], { typicalOvernight: true, travel: TRAVEL.truck, hints: ["Use Driver Hub for truck-driver Table 5 meal rates.", "Accommodation always needs written evidence."] }],
      ["Bus driver", ["Coach driver", "School bus driver"], { typicalOvernight: true }],
      ["Train driver", ["Rail conductor", "Signaller"]],
      ["Storeperson", ["Warehouse picker", "Forklift operator", "Inventory controller", "Dispatcher"]],
      ["Supply chain analyst", ["Logistics coordinator", "Import clerk", "Customs broker"]],
      ["Flight attendant", ["Cabin manager", "Purser"], { typicalOvernight: true, travel: TRAVEL.airline, hints: HINTS.airline }],
      ["Airline pilot", ["First officer", "Captain", "Regional pilot"], { typicalOvernight: true, travel: TRAVEL.airline, hints: HINTS.airline }],
      ["Air traffic controller", ["Ground handler", "Ramp agent"]],
      ["Courier", ["Bicycle courier", "Van courier"]],
      ["Taxi driver", ["Rideshare driver", "Chauffeur"]],
    ],
  },
  {
    group: "Hospitality, tourism & food",
    typicalOvernight: false,
    travel: TRAVEL.none,
    hints: HINTS.hospitality,
    items: [
      ["Chef", ["Head chef", "Sous chef", "Commis chef", "Pastry chef", "Cook"]],
      ["Waiter", ["Bartender", "Barista", "Sommelier", "Restaurant supervisor"]],
      ["Hotel receptionist", ["Duty manager", "Concierge", "Housekeeper", "Room attendant"]],
      ["Tour guide", ["Tour director", "Outdoor guide"], { typicalOvernight: true, travel: TRAVEL.tables13 }],
      ["Event coordinator", ["Wedding planner", "Conference organiser"], { typicalOvernight: true, travel: TRAVEL.tables13 }],
      ["Baker", ["Pastry cook", "Butcher", "Smallgoods maker"]],
    ],
  },
  {
    group: "Retail & personal services",
    typicalOvernight: false,
    travel: TRAVEL.none,
    hints: HINTS.retail,
    items: [
      ["Retail assistant", ["Store manager", "Department manager", "Visual merchandiser", "Checkout operator"]],
      ["Pharmacy assistant", ["Beauty consultant", "Cosmetics consultant"]],
      ["Hairdresser", ["Barber", "Beauty therapist", "Nail technician", "Spa therapist"]],
      ["Fitness instructor", ["Personal trainer", "Yoga instructor", "Swim teacher"]],
      ["Funeral director", ["Cemetery worker"]],
    ],
  },
  {
    group: "Government, defence & emergency",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.gov,
    items: [
      ["Public servant", ["APS officer", "Policy officer", "Program officer", "Case manager", "Centrelink officer"]],
      ["Local government officer", ["Town planner (council)", "Ranger", "Library officer"]],
      ["Police officer", ["Detective", "Highway patrol", "Protective service officer"], { typicalOvernight: true }],
      ["Firefighter", ["Career firefighter", "Aviation firefighter"], { typicalOvernight: true }],
      ["Defence member", ["Army soldier", "Navy sailor", "RAAF member", "Reservist"], { typicalOvernight: true }],
      ["Correctional officer", ["Youth justice worker"]],
      ["Member of parliament", ["Senator", "Electorate officer"], { travel: TRAVEL.tribunal }],
      ["Judge", ["Magistrate", "Tribunal member"], { travel: TRAVEL.tribunal }],
    ],
  },
  {
    group: "Media, design & creative",
    typicalOvernight: false,
    travel: TRAVEL.tables13,
    hints: HINTS.office,
    items: [
      ["Journalist", ["News reporter", "Producer", "Editor", "Copywriter"], { typicalOvernight: true }],
      ["Graphic designer", ["Art director", "Illustrator", "Animator"]],
      ["Photographer", ["Videographer", "Camera operator"], { typicalOvernight: true }],
      ["Social media manager", ["Community manager"]],
      ["Actor", ["Musician", "Sound technician", "Stage manager"]],
    ],
  },
  {
    group: "Agriculture & environment",
    typicalOvernight: false,
    travel: TRAVEL.itinerant,
    hints: HINTS.construction,
    items: [
      ["Farm worker", ["Station hand", "Jackaroo", "Jillaroo", "Dairy worker", "Shearer"], { typicalOvernight: true }],
      ["Farm manager", ["Agronomist", "Stock agent"], { typicalOvernight: true }],
      ["Park ranger", ["Conservation officer", "Fisheries officer"], { typicalOvernight: true }],
      ["Pest controller", ["Weed technician"]],
    ],
  },
  {
    group: "Security, cleaning & facilities",
    typicalOvernight: false,
    travel: TRAVEL.none,
    hints: HINTS.retail,
    items: [
      ["Security officer", ["Crowd controller", "Cash-in-transit officer", "Control room operator"]],
      ["Cleaner", ["Commercial cleaner", "Hospital cleaner", "Window cleaner"]],
      ["Facilities manager", ["Building manager", "Caretaker"]],
      ["Waste collector", ["Recycling sorter"]],
    ],
  },
  {
    group: "Consulting & professional services",
    typicalOvernight: true,
    travel: TRAVEL.tables13,
    hints: HINTS.sales,
    items: [
      ["Management consultant", ["Strategy consultant", "Operations consultant", "Change manager"]],
      ["IT contractor", ["Independent consultant", "Contractor (PAYG)", "Labour-hire contractor"]],
      ["Recruitment consultant", ["Executive search consultant"]],
      ["Translator", ["Interpreter"]],
    ],
  },
];

function expand() {
  const out = [];
  for (const g of GROUPS) {
    for (const item of g.items) {
      const [parent, children, extra = {}] = item;
      const parentOcc = makeOcc({
        name: parent,
        parent: null,
        group: g.group,
        typicalOvernight: extra.typicalOvernight != null ? extra.typicalOvernight : g.typicalOvernight,
        travel: extra.travel || g.travel,
        hints: extra.hints || g.hints,
      });
      out.push(parentOcc);
      for (const child of children || []) {
        out.push(
          makeOcc({
            name: child,
            parent,
            group: g.group,
            typicalOvernight: extra.typicalOvernight != null ? extra.typicalOvernight : g.typicalOvernight,
            travel: extra.travel || g.travel,
            hints: extra.hints || g.hints,
          })
        );
      }
    }
  }
  return out;
}

function makeOcc({ name, parent, group, typicalOvernight, travel, hints }) {
  const id = slug(parent ? `${parent}_${name}` : name);
  const keywords = [name, parent, group]
    .filter(Boolean)
    .flatMap((s) => String(s).toLowerCase().split(/[^a-z0-9]+/))
    .filter((w) => w.length > 2);
  return {
    id,
    name,
    parent: parent || null,
    group,
    typicalOvernight: Boolean(typicalOvernight),
    travelKind: travel.kind,
    travelLabel: travel.label,
    travelHint: travel.determinationHint,
    deductionHints: hints.slice(),
    keywords: [...new Set(keywords)],
  };
}

const OCCUPATIONS = expand();

function listOccupations() {
  return OCCUPATIONS.map((o) => ({ ...o }));
}

function listOccupationGroups() {
  return GROUPS.map((g) => g.group);
}

function findOccupation(query) {
  const q = String(query || "").trim();
  if (!q) return null;
  const exact = OCCUPATIONS.find((o) => o.id === slug(q) || o.name.toLowerCase() === q.toLowerCase());
  if (exact) return { ...exact };
  const loose = OCCUPATIONS.find((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  return loose ? { ...loose } : null;
}

function scoreOccupation(row, q) {
  const name = row.name.toLowerCase();
  const parent = String(row.parent || "").toLowerCase();
  const group = String(row.group || "").toLowerCase();
  if (name === q) return 120;
  if (name.startsWith(q)) return 100;
  if (parent === q) return 90;
  if (name.includes(q)) return 80;
  if (parent.startsWith(q) || parent.includes(q)) return 70;
  if ((row.keywords || []).some((k) => k === q || k.startsWith(q))) return 60;
  if (group.includes(q)) return 40;
  return 0;
}

function searchOccupations(query, { limit = 20 } = {}) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const cap = Math.min(40, Math.max(1, Number(limit) || 20));
  if (!q) {
    return OCCUPATIONS.filter((o) => !o.parent).slice(0, cap).map(presentOccupation);
  }
  const scored = [];
  for (const row of OCCUPATIONS) {
    const score = scoreOccupation(row, q);
    if (score > 0) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, cap).map(({ row }) => presentOccupation(row));
}

function presentOccupation(row) {
  return {
    id: row.id,
    name: row.name,
    parent: row.parent,
    group: row.group,
    label: row.parent ? `${row.parent} · ${row.name}` : row.name,
    typicalOvernight: row.typicalOvernight,
    travelKind: row.travelKind,
    travelLabel: row.travelLabel,
    travelHint: row.travelHint,
    deductionHints: row.deductionHints,
  };
}

function showsOvernightTravel(profile = {}) {
  const travel = profile.travelsForWork === true || profile.travelsForWork === "true" || profile.travelsForWork === "on" || profile.travelsForWork === 1 || profile.travelsForWork === "1";
  const nights =
    profile.overnightAllowance === true ||
    profile.overnightAllowance === "true" ||
    profile.overnightAllowance === "on" ||
    profile.overnightAllowance === 1 ||
    profile.overnightAllowance === "1";
  return Boolean(travel && nights);
}

module.exports = {
  TRAVEL,
  OCCUPATIONS,
  listOccupations,
  listOccupationGroups,
  findOccupation,
  searchOccupations,
  presentOccupation,
  showsOvernightTravel,
};
