/**
 * Australian trading names (brands people work for), not legal entity suffixes.
 * Compiled from major private employers, ASX consumer brands, government,
 * health, education, professional services and hospitality. Free-typed names
 * still save; this list only powers predictive text.
 */

function rec(name, aliases = [], sector = "") {
  return {
    name,
    aliases: aliases.map((a) => String(a).toLowerCase()),
    sector,
  };
}

const EMPLOYERS = [
  // Supermarkets & everyday retail
  rec("Woolworths", ["wow", "woolies", "woolworths supermarket"], "retail"),
  rec("Big W", ["bigw"], "retail"),
  rec("Everyday Extra", ["everyday market"], "retail"),
  rec("Coles", ["coles supermarket", "coles group"], "retail"),
  rec("Liquorland", ["liquor land"], "retail"),
  rec("First Choice Liquor", ["first choice"], "retail"),
  rec("ALDI", ["aldi australia"], "retail"),
  rec("IGA", ["independent grocers"], "retail"),
  rec("Foodland", [], "retail"),
  rec("Foodworks", [], "retail"),
  rec("Harris Farm Markets", ["harris farm"], "retail"),
  rec("Costco", ["costco australia"], "retail"),
  rec("Metcash", ["iga distribution"], "retail"),

  // Wesfarmers brands (trading names)
  rec("Bunnings", ["bunnings warehouse"], "retail"),
  rec("Kmart", ["kmart australia"], "retail"),
  rec("Target", ["target australia"], "retail"),
  rec("Officeworks", [], "retail"),
  rec("Catch", ["catch.com.au"], "retail"),
  rec("Kleenheat", [], "energy"),

  // Department, fashion, specialty
  rec("Myer", [], "retail"),
  rec("David Jones", ["djones"], "retail"),
  rec("JB Hi-Fi", ["jb hifi", "jbhifi"], "retail"),
  rec("The Good Guys", ["good guys"], "retail"),
  rec("Harvey Norman", ["domayne", "joyce mayne"], "retail"),
  rec("Domayne", [], "retail"),
  rec("Supercheap Auto", ["super cheap auto"], "retail"),
  rec("Rebel", ["rebel sport"], "retail"),
  rec("BCF", ["boating camping fishing"], "retail"),
  rec("Macpac", [], "retail"),
  rec("Cotton On", ["cotton on group", "factorie", "rubi"], "retail"),
  rec("Country Road", ["witchery", "mimco", "trenery"], "retail"),
  rec("The Reject Shop", [], "retail"),
  rec("Chemist Warehouse", ["chemistwarehouse"], "retail"),
  rec("Priceline", ["priceline pharmacy"], "retail"),
  rec("TerryWhite Chemmart", ["terry white"], "retail"),
  rec("Amcal", [], "retail"),
  rec("Bloom", ["bloom hair"], "retail"),

  // Banks & insurers
  rec("Commonwealth Bank", ["cba", "commbank"], "banking"),
  rec("Westpac", ["westpac banking"], "banking"),
  rec("St George", ["st george bank"], "banking"),
  rec("Bank of Melbourne", [], "banking"),
  rec("BankSA", ["bank sa"], "banking"),
  rec("NAB", ["national australia bank"], "banking"),
  rec("ANZ", ["anz bank"], "banking"),
  rec("Macquarie", ["macquarie bank", "macquarie group"], "banking"),
  rec("ING", ["ing australia"], "banking"),
  rec("Bendigo Bank", ["bendigo and adelaide"], "banking"),
  rec("Bank of Queensland", ["boq"], "banking"),
  rec("Suncorp", ["suncorp bank"], "banking"),
  rec("AMP", [], "banking"),
  rec("ME Bank", ["me bank"], "banking"),
  rec("HSBC", ["hsbc australia"], "banking"),
  rec("Citibank", ["citi australia"], "banking"),
  rec("Allianz", ["allianz australia"], "insurance"),
  rec("QBE", [], "insurance"),
  rec("IAG", ["nrma insurance", "sgio", "sgic"], "insurance"),
  rec("NRMA", ["nrma insurance"], "insurance"),
  rec("RACV", [], "insurance"),
  rec("RACQ", [], "insurance"),
  rec("RAA", [], "insurance"),
  rec("Medibank", ["medibank private"], "insurance"),
  rec("Bupa", ["bupa australia"], "insurance"),
  rec("HCF", [], "insurance"),
  rec("NIB", [], "insurance"),
  rec("HBF", [], "insurance"),

  // Telco & tech
  rec("Telstra", ["telstra group"], "telco"),
  rec("Optus", ["singtel optus"], "telco"),
  rec("Vodafone", ["tpn vodafone", "vodafone australia"], "telco"),
  rec("TPG", ["tpg telecom"], "telco"),
  rec("Belong", [], "telco"),
  rec("iiNet", ["iinet"], "telco"),
  rec("Aussie Broadband", [], "telco"),
  rec("Atlassian", [], "tech"),
  rec("Canva", [], "tech"),
  rec("Xero", [], "tech"),
  rec("MYOB", [], "tech"),
  rec("WiseTech Global", ["wisetech"], "tech"),
  rec("TechnologyOne", ["technology one"], "tech"),
  rec("Microsoft", ["microsoft australia"], "tech"),
  rec("Google", ["google australia", "alphabet"], "tech"),
  rec("Amazon", ["amazon australia", "aws", "amazon web services"], "tech"),
  rec("Meta", ["facebook australia"], "tech"),
  rec("IBM", ["ibm australia"], "tech"),
  rec("Salesforce", [], "tech"),
  rec("Oracle", ["oracle australia"], "tech"),
  rec("SAP", ["sap australia"], "tech"),
  rec("Apple", ["apple australia"], "tech"),

  // Resources & energy
  rec("BHP", ["bhp group"], "resources"),
  rec("Rio Tinto", ["rio"], "resources"),
  rec("Fortescue", ["fmg", "fortescue metals"], "resources"),
  rec("Hancock Prospecting", ["hancock"], "resources"),
  rec("Newmont", ["newcrest"], "resources"),
  rec("South32", [], "resources"),
  rec("Mineral Resources", ["minres"], "resources"),
  rec("Northern Star", [], "resources"),
  rec("Evolution Mining", [], "resources"),
  rec("Yancoal", [], "resources"),
  rec("Glencore", ["glencore australia"], "resources"),
  rec("Woodside", ["woodside energy"], "energy"),
  rec("Santos", [], "energy"),
  rec("Origin Energy", ["origin"], "energy"),
  rec("AGL", ["agl energy"], "energy"),
  rec("EnergyAustralia", ["energy australia"], "energy"),
  rec("Alinta Energy", ["alinta"], "energy"),
  rec("Ampol", ["caltex"], "energy"),
  rec("BP", ["bp australia"], "energy"),
  rec("Shell", ["shell australia"], "energy"),
  rec("United Petroleum", ["united"], "energy"),
  rec("7-Eleven", ["7 eleven", "seven eleven"], "retail"),

  // Health
  rec("NSW Health", ["nsw health", "health nsw"], "health"),
  rec("Queensland Health", ["qld health"], "health"),
  rec("SA Health", [], "health"),
  rec("WA Health", ["health department wa"], "health"),
  rec("Victorian Department of Health", ["safer care victoria"], "health"),
  rec("Tasmanian Health Service", ["ths"], "health"),
  rec("Canberra Health Services", [], "health"),
  rec("Ramsay Health Care", ["ramsay"], "health"),
  rec("Healthscope", [], "health"),
  rec("St Vincent's Health", ["st vincents"], "health"),
  rec("Mater", ["mater health"], "health"),
  rec("Sonic Healthcare", ["douglass hanly moir", "sullivan nicolaides"], "health"),
  rec("Healius", ["lavertys", "qml"], "health"),
  rec("CSL", ["csl behring", "seqirus"], "health"),
  rec("Cochlear", [], "health"),
  rec("ResMed", [], "health"),
  rec("Icon Cancer Centre", ["icon group"], "health"),

  // Government & education
  rec("Australian Public Service", ["aps", "australian government"], "government"),
  rec("Services Australia", ["centrelink", "medicare office"], "government"),
  rec("Australian Taxation Office", ["ato"], "government"),
  rec("Department of Defence", ["defence", "adf"], "government"),
  rec("Australian Federal Police", ["afp"], "government"),
  rec("NSW Police", [], "government"),
  rec("Victoria Police", [], "government"),
  rec("Queensland Police", ["qps"], "government"),
  rec("Australia Post", ["auspost"], "government"),
  rec("ABC", ["australian broadcasting corporation"], "media"),
  rec("SBS", [], "media"),
  rec("University of Melbourne", ["unimelb"], "education"),
  rec("University of Sydney", ["usyd"], "education"),
  rec("UNSW", ["university of new south wales"], "education"),
  rec("Monash University", ["monash"], "education"),
  rec("ANU", ["australian national university"], "education"),
  rec("University of Queensland", ["uq"], "education"),
  rec("QUT", ["queensland university of technology"], "education"),
  rec("RMIT", ["rmit university"], "education"),
  rec("Deakin University", ["deakin"], "education"),
  rec("La Trobe University", ["latrobe"], "education"),
  rec("Griffith University", ["griffith"], "education"),
  rec("UTS", ["university of technology sydney"], "education"),
  rec("Macquarie University", ["mq"], "education"),
  rec("Curtin University", ["curtin"], "education"),
  rec("UWA", ["university of western australia"], "education"),
  rec("University of Adelaide", ["adelaide university"], "education"),
  rec("University of Tasmania", ["utas"], "education"),
  rec("TAFE NSW", [], "education"),
  rec("TAFE Queensland", [], "education"),
  rec("Holmesglen", [], "education"),
  rec("Department of Education NSW", ["nsw education"], "education"),
  rec("Department of Education Victoria", ["vic education"], "education"),
  rec("Department of Education Queensland", ["eq", "education queensland"], "education"),

  // Professional services
  rec("PwC", ["pricewaterhousecoopers"], "professional"),
  rec("Deloitte", [], "professional"),
  rec("EY", ["ernst and young", "ernst & young"], "professional"),
  rec("KPMG", [], "professional"),
  rec("Accenture", [], "professional"),
  rec("McKinsey", ["mckinsey and company"], "professional"),
  rec("Boston Consulting Group", ["bcg"], "professional"),
  rec("Bain & Company", ["bain"], "professional"),
  rec("Capgemini", [], "professional"),
  rec("Cognizant", [], "professional"),
  rec("Hays", ["hays recruiting"], "professional"),
  rec("Robert Half", [], "professional"),
  rec("Randstad", [], "professional"),
  rec("Adecco", [], "professional"),
  rec("Programmed", [], "professional"),
  rec("Chandler Macleod", [], "professional"),

  // Construction & infrastructure
  rec("Lendlease", ["lend lease"], "construction"),
  rec("CIMIC", ["cpb contractors", "leighton"], "construction"),
  rec("CPB Contractors", ["cpb"], "construction"),
  rec("John Holland", [], "construction"),
  rec("Multiplex", [], "construction"),
  rec("Laing O'Rourke", ["laing orourke"], "construction"),
  rec("Hutchinson Builders", ["hutchies"], "construction"),
  rec("McConnell Dowell", [], "construction"),
  rec("Downer", ["downer edi"], "construction"),
  rec("Ventia", [], "construction"),
  rec("Transurban", [], "construction"),
  rec("Broadspectrum", ["ventia broadspectrum"], "construction"),
  rec("Mirvac", [], "construction"),
  rec("Stockland", [], "construction"),
  rec("GPT", [], "construction"),
  rec("Scentre Group", ["westfield"], "retail"),
  rec("Westfield", [], "retail"),

  // Airlines, travel, logistics
  rec("Qantas", ["qantas airways"], "aviation"),
  rec("Jetstar", [], "aviation"),
  rec("Virgin Australia", ["virgin"], "aviation"),
  rec("Rex", ["regional express"], "aviation"),
  rec("Airservices Australia", [], "aviation"),
  rec("Toll", ["toll group"], "logistics"),
  rec("Linfox", [], "logistics"),
  rec("Team Global Express", ["tge"], "logistics"),
  rec("StarTrack", ["star track"], "logistics"),
  rec("FedEx", [], "logistics"),
  rec("DHL", [], "logistics"),
  rec("TNT", [], "logistics"),
  rec("Aurizon", [], "logistics"),
  rec("Pacific National", [], "logistics"),
  rec("Mainfreight", [], "logistics"),
  rec("Qube", ["qube logistics"], "logistics"),

  // Hospitality & food
  rec("McDonald's", ["mcdonalds", "maccas"], "hospitality"),
  rec("Hungry Jack's", ["hungry jacks", "burger king"], "hospitality"),
  rec("KFC", ["kfc australia"], "hospitality"),
  rec("Subway", [], "hospitality"),
  rec("Domino's", ["dominos"], "hospitality"),
  rec("Pizza Hut", [], "hospitality"),
  rec("Grill'd", ["grilld"], "hospitality"),
  rec("Guzman y Gomez", ["gyg"], "hospitality"),
  rec("Nando's", ["nandos"], "hospitality"),
  rec("Red Rooster", [], "hospitality"),
  rec("Coffee Club", [], "hospitality"),
  rec("Gloria Jean's", ["gloria jeans"], "hospitality"),
  rec("Starbucks", ["starbucks australia"], "hospitality"),
  rec("Boost Juice", [], "hospitality"),
  rec("Guzman", [], "hospitality"),
  rec("Accor", ["ibis", "novotel", "mercure", "pullman"], "hospitality"),
  rec("Hilton", ["hilton australia"], "hospitality"),
  rec("Marriott", ["marriott australia"], "hospitality"),
  rec("Mantra", ["mantra hotels"], "hospitality"),
  rec("Quest Apartments", ["quest"], "hospitality"),
  rec("IHG", ["holiday inn", "crowne plaza"], "hospitality"),
  rec("Club Med", [], "hospitality"),
  rec("Flight Centre", ["fctg"], "travel"),
  rec("Webjet", [], "travel"),
  rec("Helloworld", [], "travel"),

  // Media & telco-adjacent
  rec("Nine", ["nine entertainment", "channel 9"], "media"),
  rec("Seven", ["seven west", "channel 7"], "media"),
  rec("Ten", ["paramount ten", "channel 10"], "media"),
  rec("News Corp", ["news limited", "the australian"], "media"),
  rec("Nine Newspapers", ["smh", "the age"], "media"),
  rec("Foxtel", [], "media"),

  // Other large employers
  rec("Wesfarmers", [], "retail"),
  rec("Woolworths Group", [], "retail"),
  rec("Coles Group", [], "retail"),
  rec("Aristocrat", ["aristocrat leisure"], "other"),
  rec("Carsales", ["carsales.com.au"], "other"),
  rec("REA Group", ["realestate.com.au"], "other"),
  rec("Seek", [], "other"),
  rec("Domain", [], "other"),
  rec("Coates Hire", ["coates"], "other"),
  rec("Kennards Hire", ["kennards"], "other"),
  rec("Boral", [], "construction"),
  rec("CSR", [], "construction"),
  rec("James Hardie", [], "construction"),
  rec("BlueScope", ["bluescope steel"], "resources"),
  rec("Orica", [], "resources"),
  rec("Incitec Pivot", ["incitec"], "resources"),
  rec("Treasury Wine Estates", ["penfolds", "wolf blass"], "other"),
  rec("Coca-Cola Europacific Partners", ["coca cola", "coke"], "other"),
  rec("Lion", ["tooheys", "xxxx"], "other"),
  rec("Asahi", ["carlton draught", "great northern"], "other"),
  rec("Unilever", [], "other"),
  rec("Procter & Gamble", ["pg"], "other"),
  rec("Nestlé", ["nestle"], "other"),
  rec("Fonterra", [], "other"),
  rec("a2 Milk", ["a2"], "other"),
  rec("ResMed", [], "health"),
];

function present(row) {
  return { name: row.name, sector: row.sector || "" };
}

function scoreEmployer(row, q) {
  const name = row.name.toLowerCase();
  if (name === q) return 120;
  if (name.startsWith(q)) return 100;
  if (name.includes(q)) return 80;
  for (const a of row.aliases || []) {
    if (a === q) return 110;
    if (a.startsWith(q)) return 90;
    if (a.includes(q)) return 65;
  }
  if ((row.sector || "").includes(q)) return 30;
  return 0;
}

function searchEmployers(query, { limit = 20 } = {}) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  const cap = Math.min(40, Math.max(1, Number(limit) || 20));
  if (!q) {
    return EMPLOYERS.slice(0, cap).map(present);
  }
  const scored = [];
  for (const row of EMPLOYERS) {
    const score = scoreEmployer(row, q);
    if (score > 0) scored.push({ row, score });
  }
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, cap).map(({ row }) => present(row));
}

function listEmployers() {
  return EMPLOYERS.map(present);
}

module.exports = {
  EMPLOYERS,
  searchEmployers,
  listEmployers,
};
