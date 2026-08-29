export const Q10_TARGET_AVERAGE = 9.5;

function validQuality(value) {
  const quality = Number(value);
  return Number.isInteger(quality) && quality >= 1 && quality <= 10 ? quality : null;
}

export function calculateQ10Requirements(components, collectedComponentIds, componentQualities) {
  const componentIds = components.map((component) => component.id).filter(Boolean);
  const componentIdSet = new Set(componentIds);
  const collected = new Set(
    (collectedComponentIds || []).filter((componentId) => componentIdSet.has(componentId)),
  );

  let knownQualitySum = 0;
  let knownFoundCount = 0;
  for (const componentId of collected) {
    const quality = validQuality(componentQualities?.[componentId]);
    if (quality === null) continue;
    knownQualitySum += quality;
    knownFoundCount += 1;
  }

  const totalCount = componentIds.length;
  const foundCount = collected.size;
  const missingCount = totalCount - foundCount;
  const unknownFoundCount = foundCount - knownFoundCount;
  const targetTotal = Q10_TARGET_AVERAGE * totalCount;

  if (!totalCount) {
    return { status: "empty", totalCount, foundCount, missingCount, unknownFoundCount };
  }

  if (unknownFoundCount) {
    return {
      status: "needs-quality",
      totalCount,
      foundCount,
      missingCount,
      unknownFoundCount,
      knownQualitySum,
    };
  }

  if (!missingCount) {
    const finalAverage = knownQualitySum / totalCount;
    return {
      status: finalAverage >= Q10_TARGET_AVERAGE ? "achieved" : "missed",
      totalCount,
      foundCount,
      missingCount,
      unknownFoundCount,
      knownQualitySum,
      finalAverage,
    };
  }

  const remainingTotalNeeded = targetTotal - knownQualitySum;
  const requiredRemainingAverage = remainingTotalNeeded / missingCount;
  const minimumQualityIfOthersTen = Math.max(
    1,
    Math.ceil(remainingTotalNeeded - (10 * (missingCount - 1)) - 1e-9),
  );

  return {
    status: requiredRemainingAverage > 10 ? "impossible" : "in-progress",
    totalCount,
    foundCount,
    missingCount,
    unknownFoundCount,
    knownQualitySum,
    requiredRemainingAverage,
    minimumQualityIfOthersTen,
  };
}
