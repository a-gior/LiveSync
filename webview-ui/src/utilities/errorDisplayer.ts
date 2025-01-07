class ErrorDisplayer {
  private readonly displayDuration: number = 5000; // milliseconds

  display(element: HTMLElement, position: "bottom", errorMessage: string) {
    // Remove existing error messages to avoid duplicates
    // const existingError = element.querySelector(".error-message");
    // if (existingError) {
    //   existingError.remove();
    // }

    // Create error message element
    const errorDiv = document.createElement("div");
    errorDiv.textContent = errorMessage;
    errorDiv.classList.add("error-message");
    errorDiv.style.color = "var(--vscode-errorForeground)";
    errorDiv.style.fontSize = "0.8em";
    errorDiv.style.marginTop = "0.2em";

    // Add error message below the element
    element.appendChild(errorDiv);

    // Find the input element inside the container and highlight it
    const inputElement = element.querySelector("input") as HTMLInputElement;
    if (inputElement) {
      inputElement.style.border = "1px solid var(--vscode-errorForeground)";
      inputElement.style.opacity = "0.6";
    }

    // Remove the error message after the display duration
    setTimeout(() => {
      errorDiv.remove();
      if (inputElement instanceof HTMLInputElement) {
        // Reset border
        inputElement.style.border = "";
        inputElement.style.opacity = "1";
      }
    }, this.displayDuration);
  }
}

export const errorDisplayer = new ErrorDisplayer();
