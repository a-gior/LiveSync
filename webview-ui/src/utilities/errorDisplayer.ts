class ErrorDisplayer {
  private readonly displayDuration: number = 3000; // milliseconds

  display(
    element: HTMLElement,
    position: "top" | "bottom",
    errorMessage: string,
  ) {
    const parentElement = element.parentNode;
    const errorDiv = document.createElement("div");
    errorDiv.textContent = errorMessage;
    errorDiv.style.color = "red";
    errorDiv.classList.add("error-message");

    if (position === "top") {
      parentElement.prepend(errorDiv);
    } else {
      parentElement.appendChild(errorDiv);
    }

    if (element instanceof HTMLInputElement) {
      element.style.border = "1px solid red";
    }

    setTimeout(() => {
      errorDiv.remove();
      element.style.border = ""; // Reset border
    }, this.displayDuration);
  }
}

export const errorDisplayer = new ErrorDisplayer();
