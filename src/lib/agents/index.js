import edgar  from './edgar.js'
import brad   from './brad.js'
import ledger from './ledger.js'
import annie  from './annie.js'
import { registerPlugin, getPlugin, getAllPlugins } from '../plugins/index.js'

registerPlugin(edgar)
registerPlugin(brad)
registerPlugin(ledger)
registerPlugin(annie)

export { edgar, brad, ledger, annie }
export const AGENTS = [edgar, brad, ledger, annie]

export function getAgent(capability, role = 'sales_rep') {
  return getPlugin(capability, role)
}

export function getAllAgents() {
  return getAllPlugins().filter(p => p.type === 'agent')
}
