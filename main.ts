import { Plugin, ItemView, WorkspaceLeaf } from 'obsidian';

export default class HelloWorldPanel extends Plugin {
  async onload() {
    this.registerView(
      'hello-world-view',
      (leaf) => new HelloWorldView(leaf)
    );

    this.addRibbonIcon('message-circle', 'Hello World Panel', () => {
      this.activateView();
    });

    await this.activateView();
  }

  async activateView() {
    const workspace = this.app.workspace;
    
    const rightLeaf = workspace.getRightLeaf(false);
    if (!rightLeaf) return;
    
    await rightLeaf.setViewState({
      type: 'hello-world-view',
      active: true,
    });
    
    workspace.revealLeaf(rightLeaf);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType('hello-world-view');
  }
}

class HelloWorldView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType() {
    return 'hello-world-view';
  }

  getDisplayText() {
    return 'Hello World';
  }

  async onOpen() {
    this.containerEl.empty();
    this.containerEl.createEl('h2', { text: 'Hello World' });
    this.containerEl.createEl('p', { text: 'This is a panel on the right side!' });
  }

  async onClose() {
    this.containerEl.empty();
  }
}
