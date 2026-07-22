const NEW_SKILL_DIALOG_OPEN_EVENT = "t3code:open-new-skill-dialog";

export function openNewSkillDialog(): void {
  window.dispatchEvent(new Event(NEW_SKILL_DIALOG_OPEN_EVENT));
}

export function onOpenNewSkillDialog(listener: () => void): () => void {
  window.addEventListener(NEW_SKILL_DIALOG_OPEN_EVENT, listener);
  return () => window.removeEventListener(NEW_SKILL_DIALOG_OPEN_EVENT, listener);
}
