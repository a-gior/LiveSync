class Utils {
  clone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}

export const utils = new Utils();
