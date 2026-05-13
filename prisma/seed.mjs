import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const QUESTIONS = [
  // ── RAPPORT ────────────────────────────────────────────────────────────────
  {
    phase: 'RAPPORT', order: 1, inputType: 'TEXT',
    questionText: 'How long have you been the AD here?',
    helpText: 'Have they always been in athletic administration?',
  },
  {
    phase: 'RAPPORT', order: 2, inputType: 'NUMBER',
    questionText: 'How many sports are you currently running?',
    helpText: null,
  },
  {
    phase: 'RAPPORT', order: 3, inputType: 'TEXTAREA',
    questionText: "What's the biggest thing on your plate heading into next season?",
    helpText: null,
  },
  {
    phase: 'RAPPORT', order: 4, inputType: 'TEXTAREA',
    questionText: "Any coaches newer to the program — turnover that changes how you source gear?",
    helpText: null,
  },

  // ── INTRO ──────────────────────────────────────────────────────────────────
  {
    phase: 'INTRO', order: 1, inputType: 'TEXTAREA',
    questionText: 'Initial reaction / interest signals?',
    helpText: 'Note their response to the ST1 overview',
  },
  {
    phase: 'INTRO', order: 2, inputType: 'TEXTAREA',
    questionText: 'Anything they mentioned about current vendors or relationships?',
    helpText: null,
  },

  // ── DISCOVERY ──────────────────────────────────────────────────────────────
  {
    phase: 'DISCOVERY', order: 1, inputType: 'SELECT',
    questionText: 'Do they go through a single supplier or split across multiple vendors?',
    selectOptions: ['Single supplier', 'Multiple vendors', 'No consistent vendor', 'Unknown'],
    helpText: null,
  },
  {
    phase: 'DISCOVERY', order: 2, inputType: 'SELECT',
    questionText: 'Purchasing through a state contract or co-op, or more direct?',
    selectOptions: ['State contract', 'Purchasing co-op', 'Direct', 'Mix', 'Unknown'],
    helpText: null,
  },
  {
    phase: 'DISCOVERY', order: 3, inputType: 'TEXTAREA',
    questionText: 'Who places the orders — AD, coaches, office admin, or all three?',
    helpText: null,
  },
  {
    phase: 'DISCOVERY', order: 4, inputType: 'SELECT',
    questionText: 'Budget structure?',
    selectOptions: ['Locked at start of year', 'Sport-by-sport requests', 'Combination', 'Unknown'],
    helpText: null,
  },
  {
    phase: 'DISCOVERY', order: 5, inputType: 'TEXTAREA',
    questionText: 'Do they have a uniform vendor they return to each year?',
    helpText: null,
  },
  {
    phase: 'DISCOVERY', order: 6, inputType: 'SELECT',
    questionText: 'Who sources practice gear and sideline apparel?',
    selectOptions: ['Coaches', 'Parents', 'School', 'Mix', 'Unknown'],
    helpText: null,
  },
  {
    phase: 'DISCOVERY', order: 7, inputType: 'SELECT',
    questionText: 'Custom sublimation or off-the-shelf decorated?',
    selectOptions: ['Full custom sublimation', 'Off-the-shelf decorated', 'Mix', 'Unknown'],
    helpText: null,
  },
  {
    phase: 'DISCOVERY', order: 8, inputType: 'TEXTAREA',
    questionText: 'How are parents getting branded gear right now?',
    helpText: 'Is there any informal sourcing happening?',
  },
  {
    phase: 'DISCOVERY', order: 9, inputType: 'TEXTAREA',
    questionText: "Booster club notes — are they running their own merch or fundraising through apparel?",
    helpText: null,
  },

  // ── PAIN ───────────────────────────────────────────────────────────────────
  {
    phase: 'PAIN', order: 1, inputType: 'TEXTAREA',
    questionText: 'Which pain points resonated most strongly?',
    helpText: 'Reference the pain cards you confirmed during the call',
  },
  {
    phase: 'PAIN', order: 2, inputType: 'TEXTAREA',
    questionText: 'Any specific frustrations they volunteered unprompted?',
    helpText: null,
  },

  // ── SOLUTION ───────────────────────────────────────────────────────────────
  {
    phase: 'SOLUTION', order: 1, inputType: 'SELECT',
    questionText: 'Which close option was used?',
    selectOptions: [
      'Warm — sending overview this week',
      'Loop someone in',
      'Budget timing — follow up later',
      'No next step',
    ],
    helpText: null,
  },
  {
    phase: 'SOLUTION', order: 2, inputType: 'TEXTAREA',
    questionText: 'Next step — specific date, follow-up, or additional contacts?',
    helpText: null,
  },
  {
    phase: 'SOLUTION', order: 3, inputType: 'TEXTAREA',
    questionText: 'Anything else to reference in the follow-up email?',
    helpText: null,
  },
];

async function main() {
  console.log('Seeding TalkTrackQuestion…');
  // Wipe and re-create so the seed is always idempotent
  await prisma.talkTrackQuestion.deleteMany({});
  const questions = await prisma.talkTrackQuestion.createMany({
    data: QUESTIONS.map(q => ({
      phase:         q.phase,
      order:         q.order,
      questionText:  q.questionText,
      helpText:      q.helpText ?? null,
      inputType:     q.inputType,
      selectOptions: q.selectOptions ?? null,
      isActive:      true,
      isRequired:    false,
    })),
  });
  console.log(`  Created ${questions.count} questions`);

  console.log('Seeding SponsorshipConfig…');
  await prisma.sponsorshipConfig.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id:                         1,
      avgOrderValuePerAthlete:    85,
      avgEquipmentOrderPerSport:  400,
      netMarginPct:               0.18,
      givebackPct:                0.30,
      schoolClassConfidence:      { '1A': 0.40, '2A': 0.50, '3A': 0.60, '4A': 0.70, '5A': 0.78, '6A': 0.85 },
      teamStoreRevenuePerAthlete: 35,
      purchaseFrequencyPerYear:   1.5,
      boosterMultiplier:          1.15,
      lastUpdatedBy:              null,
    },
  });
  console.log('  SponsorshipConfig row upserted (id=1)');

  console.log('Done.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
