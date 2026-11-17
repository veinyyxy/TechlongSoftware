// AWS SDK Date objects and CLI ISO strings must compare at millisecond precision.
const milliseconds = value => value instanceof Date ? value.getTime()
  : typeof value === 'string' ? Date.parse(value) : Number.NaN;

export function sameInstallationInstant(actual, expected) {
  const actualTime = milliseconds(actual), expectedTime = milliseconds(expected);
  return Number.isFinite(actualTime) && Number.isFinite(expectedTime) && actualTime === expectedTime;
}
