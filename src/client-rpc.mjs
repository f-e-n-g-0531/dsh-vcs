/** Adapt the authenticated host envelope without owning Session or UI state. */
export function createClientRpc(connection, fallbackMessage) {
  return async (endpoint, payload, signal) => {
    const result = await connection.rpc.call('/vcs-rpc', endpoint, payload, signal);
    if (!result.ok) {
      const error = new Error(result.error?.message || String(result.error || fallbackMessage()));
      error.code = result.error?.code;
      throw error;
    }
    return result.value;
  };
}
