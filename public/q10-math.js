export const Q10_TARGET_AVERAGE = 9.5;

function validQuality(value) {
  const quality = Number(value);
  return Number.isInteger(quality) && quality >= 1 && quality <= 10 ? quality : null;
}

export function targetAverageForQuality(targetQuality) {
  const quality = validQuality(targetQuality);
  if (quality === null) throw new Error("Target quality must be a whole number from 1 to 10.");
  return quality === 1 ? 1 : quality - 0.5;
}

export function collectLeafComponents(component) {
  if (!component) return [];
  if (component.type !== "set") return component.id ? [component] : [];
  return (component.components || []).flatMap(collectLeafComponents);
}

export function evaluateComponent(component, collectedComponentIds, componentQualities) {
  const collected = collectedComponentIds instanceof Set
    ? collectedComponentIds
    : new Set(collectedComponentIds || []);

  if (component.type !== "set") {
    const found = collected.has(component.id);
    const quality = found ? validQuality(componentQualities?.[component.id]) : null;
    return {
      complete: found && quality !== null,
      found,
      needsQuality: found && quality === null,
      quality,
      leafCount: component.id ? 1 : 0,
      foundLeafCount: found ? 1 : 0,
    };
  }

  const childEvaluations = (component.components || []).map((child) => ({
    component: child,
    evaluation: evaluateComponent(child, collected, componentQualities),
  }));
  const complete = childEvaluations.length > 0 && childEvaluations.every(({ evaluation }) => evaluation.complete);
  const leafCount = childEvaluations.reduce((sum, child) => sum + child.evaluation.leafCount, 0);
  const foundLeafCount = childEvaluations.reduce((sum, child) => sum + child.evaluation.foundLeafCount, 0);

  if (!complete) {
    return { complete: false, childEvaluations, leafCount, foundLeafCount };
  }

  const average = childEvaluations.reduce((sum, child) => sum + child.evaluation.quality, 0) / childEvaluations.length;
  return {
    complete: true,
    quality: Math.max(1, Math.min(10, Math.round(average))),
    average,
    childEvaluations,
    leafCount,
    foundLeafCount,
  };
}

export function calculateSetRequirements(setComponent, collectedComponentIds, componentQualities, targetQuality = 10) {
  const targetAverage = targetAverageForQuality(targetQuality);
  const directComponents = setComponent?.components || [];
  const evaluations = directComponents.map((component) => ({
    component,
    evaluation: evaluateComponent(component, collectedComponentIds, componentQualities),
  }));
  const unknownFoundCount = evaluations.filter(({ component, evaluation }) => (
    component.type !== "set" && evaluation.needsQuality
  )).length;
  const knownQualitySum = evaluations.reduce((sum, { evaluation }) => (
    sum + (evaluation.complete ? evaluation.quality : 0)
  ), 0);
  const completeCount = evaluations.filter(({ evaluation }) => evaluation.complete).length;
  const totalCount = directComponents.length;
  const missingCount = totalCount - completeCount - unknownFoundCount;

  const base = {
    targetQuality,
    targetAverage,
    totalCount,
    completeCount,
    missingCount,
    unknownFoundCount,
    knownQualitySum,
    evaluations,
  };

  if (!totalCount) return { ...base, status: "empty" };
  if (unknownFoundCount) return { ...base, status: "needs-quality" };

  if (!missingCount) {
    const finalAverage = knownQualitySum / totalCount;
    const resultQuality = Math.max(1, Math.min(10, Math.round(finalAverage)));
    return {
      ...base,
      status: resultQuality >= targetQuality ? "achieved" : "missed",
      finalAverage,
      resultQuality,
    };
  }

  const remainingTotalNeeded = (targetAverage * totalCount) - knownQualitySum;
  const requiredRemainingAverage = remainingTotalNeeded / missingCount;
  const minimumQualityIfOthersTen = Math.max(
    1,
    Math.ceil(remainingTotalNeeded - (10 * (missingCount - 1)) - 1e-9),
  );

  return {
    ...base,
    status: requiredRemainingAverage > 10 ? "impossible" : "in-progress",
    requiredRemainingAverage,
    minimumQualityIfOthersTen,
  };
}

export function calculateQ10Requirements(components, collectedComponentIds, componentQualities) {
  return calculateSetRequirements(
    { type: "set", components },
    collectedComponentIds,
    componentQualities,
    10,
  );
}
