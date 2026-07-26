import edgar  from './edgar.js'
import brad   from './brad.js'
import ledger from './ledger.js'
import { registerPlugin, getPlugin, getAllPlugins } from '../plugins/index.js'

registerPlugin(edgar)
registerPlugin(brad)
registerPlugin(ledger)

export { edgar, brad, ledger }
export const AGENTS = [edgar, brad, ledger]

export function getAgent(capability, role = 'sales_rep') {
  return getPlugin(capability, role)
}

export function getAllAgents() {
  return getAllPlugins().filter(p => p.type === 'agent')
}
