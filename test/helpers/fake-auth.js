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
