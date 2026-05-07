import { App, ButtonComponent, Modal } from "obsidian";

export class TextPromptModal extends Modal {
  private readonly onSubmit: (value: string) => void;
  private readonly titleText: string;
  private readonly descriptionText: string;
  private readonly placeholderText: string;
  private readonly submitText: string;
  private textareaEl!: HTMLTextAreaElement;
  private submitBtn?: ButtonComponent;

  constructor(
    app: App,
    options: {
      title: string;
      description: string;
      placeholder: string;
      submitText: string;
      onSubmit: (value: string) => void;
    },
  ) {
    super(app);
    this.titleText = options.title;
    this.descriptionText = options.description;
    this.placeholderText = options.placeholder;
    this.submitText = options.submitText;
    this.onSubmit = options.onSubmit;
  }

  onOpen(): void {
    this.titleEl.setText(this.titleText);
    this.contentEl.addClass("oa-text-prompt-modal");

    this.contentEl.createEl("p", {
      cls: "oa-text-prompt-description",
      text: this.descriptionText,
    });

    this.textareaEl = this.contentEl.createEl("textarea", {
      cls: "oa-text-prompt-textarea",
      attr: {
        placeholder: this.placeholderText,
      },
    });

    this.textareaEl.addEventListener("input", () => {
      this.updateSubmitState();
    });
    this.textareaEl.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void this.submit();
      }
    });

    const footerEl = this.contentEl.createDiv({ cls: "oa-text-prompt-footer" });
    const cancelBtn = new ButtonComponent(footerEl);
    cancelBtn.setButtonText("Cancel").onClick(() => this.close());

    this.submitBtn = new ButtonComponent(footerEl);
    this.submitBtn
      .setButtonText(this.submitText)
      .setCta()
      .setDisabled(true)
      .onClick(() => {
        void this.submit();
      });

    window.setTimeout(() => this.textareaEl.focus(), 0);
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private updateSubmitState(): void {
    this.submitBtn?.setDisabled(this.textareaEl.value.trim().length === 0);
  }

  private async submit(): Promise<void> {
    const value = this.textareaEl.value.trim();
    if (!value) {
      return;
    }

    this.onSubmit(value);
    this.close();
  }
}
