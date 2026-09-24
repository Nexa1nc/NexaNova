export function calculateBasePriority(domain, priorities) {
  const normalized = String(domain || "").toLowerCase();

  return Number(
    priorities.get(normalized) ?? 50
  );
}
