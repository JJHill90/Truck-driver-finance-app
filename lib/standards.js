// Static reference data returned by GET /standards.
// Category ids referenced directly by public/app.js: other_work, vehicle_car, laundry.

export const categoryGroups = [
  'Vehicle & travel',
  'Meals & accommodation',
  'Clothing & laundry',
  'Equipment & phone',
  'Fees & licences',
  'Other',
]

export const categories = [
  { id: 'vehicle_car', label: 'Car (work-related)', group: 'Vehicle & travel', atoSchedule: 'D1' },
  { id: 'fuel', label: 'Fuel & oil', group: 'Vehicle & travel', atoSchedule: 'D2' },
  { id: 'tolls', label: 'Tolls & road user charges', group: 'Vehicle & travel', atoSchedule: 'D2' },
  { id: 'parking', label: 'Parking', group: 'Vehicle & travel', atoSchedule: 'D2' },
  { id: 'accommodation', label: 'Accommodation (away from home)', group: 'Meals & accommodation', atoSchedule: 'D2' },
  { id: 'meals_travel', label: 'Meals (travel allowance)', group: 'Meals & accommodation', atoSchedule: 'D2' },
  { id: 'overtime_meals', label: 'Overtime meals', group: 'Meals & accommodation', atoSchedule: 'D5' },
  { id: 'laundry', label: 'Laundry & uniform', group: 'Clothing & laundry', atoSchedule: 'D3' },
  { id: 'clothing', label: 'Protective clothing & PPE', group: 'Clothing & laundry', atoSchedule: 'D3' },
  { id: 'phone', label: 'Phone & internet', group: 'Equipment & phone', atoSchedule: 'D5' },
  { id: 'tools', label: 'Tools & equipment', group: 'Equipment & phone', atoSchedule: 'D5' },
  { id: 'union_fees', label: 'Union & association fees', group: 'Fees & licences', atoSchedule: 'D5' },
  { id: 'licences', label: 'Licences & permits', group: 'Fees & licences', atoSchedule: 'D5' },
  { id: 'training', label: 'Training & courses', group: 'Fees & licences', atoSchedule: 'D5' },
  { id: 'other_work', label: 'Other work-related', group: 'Other', atoSchedule: 'D5' },
]

export const incomeTypes = [
  { id: 'salary_wages', label: 'Salary & wages' },
  { id: 'allowance_travel', label: 'Travel allowance' },
  { id: 'allowance_overtime_meal', label: 'Overtime meal allowance' },
  { id: 'contractor', label: 'Contractor / ABN income' },
  { id: 'backpay', label: 'Back pay / bonus' },
  { id: 'other_income', label: 'Other income' },
]

export const driverTypes = {
  employee: { label: 'Employee driver' },
  owner_driver: { label: 'Owner-driver' },
  contractor: { label: 'Contractor' },
}

// ATO reasonable amounts (indicative FY2024-25 style figures) used for caps display.
export const allowanceCaps = {
  overtimeMealCap: 37.65,
  domesticTravelCaps: { accommodation: 175.0, incidentals: 23.0 },
  salaryBands: {
    band1: { max: 143650, breakfast: 28.75, lunch: 32.8, dinner: 56.6 },
    band2: { max: 255610, breakfast: 33.6, lunch: 38.35, dinner: 63.65 },
    band3: { max: Infinity, breakfast: 39.05, lunch: 44.45, dinner: 73.65 },
  },
}

export function salaryBandForSalary(annualSalary) {
  const salary = Number(annualSalary) || 0
  if (salary <= allowanceCaps.salaryBands.band1.max) return 'band1'
  if (salary <= allowanceCaps.salaryBands.band2.max) return 'band2'
  return 'band3'
}

export function standardsPayload() {
  return { categories, categoryGroups, incomeTypes, driverTypes }
}

export function categoryById(id) {
  return categories.find((c) => c.id === id)
}

export function categoryLabel(id) {
  return categoryById(id)?.label || String(id || '').replace(/_/g, ' ')
}

export function atoScheduleFor(id) {
  return categoryById(id)?.atoSchedule || 'D5'
}
