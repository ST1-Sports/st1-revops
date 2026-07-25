import edgar from './edgar.js'
import brad  from './brad.js'
import { registerPlugin, getPlugin, getAllPlugins } from '../plugins/index.js'

registerPlugin(edgar)
registerPlugin(brad)

export { edgar, brad }
export const AGENTS = [edgar, brad]

export function getAgent(capability, role = 'sales_rep') {
  return getPlugin(capability, role)
}

export function getAllAgents() {
  return getAllPlugins().filter(p => p.type === 'agent')
}
