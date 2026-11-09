export function fail(exit, result) {
  const error = new Error(result);
  error.exit = exit;
  error.result = result;
  return error;
}
