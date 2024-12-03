// debounce.ts
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    // Clear the previous timer (if it exists)
    clearTimeout(timeout);

    // Set a new timer that will call the function after `wait` milliseconds
    timeout = setTimeout(() => {
      func(...args);
    }, wait);
  };
}
