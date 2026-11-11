// Test-only: a fake Prisma (one stored app_state, captured interactions) installed before
// prisma.js is imported, and a session signing secret.
export const logged = [];
globalThis.prisma = {
  setting: {
    async findUnique() {
      return {
        key: 'app_state',
        value: {
          reps: [{ id: 'r1', email: 'rep@st1sports.com' }, { id: 'a1', email: 'boss@st1sports.com' }],
          appUsers: [{ repId: 'r1', isAdmin: false }, { repId: 'a1', isAdmin: true }],
        },
      };
    },
  },
  agentInteraction: {
    async create({ data }) { logged.push(data); return { id: `i${logged.length}`, ...data }; },
  },
};
process.env.SESSION_SECRET = 'agent-gate-test-secret-123';
