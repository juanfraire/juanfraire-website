// Copy buttons for the bios on the press pages. Without JavaScript (or without clipboard
// access) the buttons stay hidden and the text can still be selected by hand.

if (navigator.clipboard) {
  for (const button of document.querySelectorAll('[data-copy]')) {
    const source = document.getElementById(button.dataset.copy);
    if (!source) continue;
    const label = button.textContent;
    button.hidden = false;
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(source.innerText.trim());
        button.textContent = button.dataset.done;
      } catch {
        // Clipboard refused: select the text so it can be copied by hand.
        const range = document.createRange();
        range.selectNodeContents(source);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
      setTimeout(() => { button.textContent = label; }, 2000);
    });
  }
}
