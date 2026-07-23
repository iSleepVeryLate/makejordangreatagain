// Client-side mirror of the engine's task catalog order (dev harness + any UI
// that needs "all task ids" without importing server code). Keep in sync with
// supabase/functions/_shared/mundassEngine.ts TASK_IDS.
export const TASK_IDS_CLIENT = [
  'wires', 'tea', 'satellite', 'laundry', 'coffee',
  'plants', 'olives', 'shelf', 'gas', 'water',
]
