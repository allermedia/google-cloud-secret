/**
 * Fake auth client, short-circuits google auth so tests skip real token fetching
 * @returns {*} pretends to be a GoogleAuth instance
 */
export function fakeAuth() {
  return {
    getUniverseDomain() {
      return 'googleapis.com';
    },
    getClient() {
      return {
        getRequestHeaders() {
          return new Map();
        },
      };
    },
  };
}
