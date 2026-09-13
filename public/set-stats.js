function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatCombatValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "");
}

export function formatSetStats(assembled, q10) {
  const parts = [];
  const difficulty = optionalNumber(assembled?.difficulty);
  if (difficulty !== null) parts.push(`Difficulty: ${difficulty.toFixed(2)} / 10`);

  const quality = q10 ? "Q10" : "Q5";
  const attack = optionalNumber(q10 ? assembled?.q10Attack : assembled?.q5Attack);
  const defense = optionalNumber(q10 ? assembled?.q10Defense : assembled?.q5Defense);
  const combat = [];
  if (attack !== null) combat.push(`${formatCombatValue(attack)} ATK`);
  if (defense !== null) combat.push(`${formatCombatValue(defense)} DEF`);
  if (combat.length) parts.push(`${quality} ${combat.join(" / ")}`);

  return parts.join(" · ");
}

