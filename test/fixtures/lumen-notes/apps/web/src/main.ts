const target = document.querySelector<HTMLParagraphElement>("#greeting");
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";

fetch(`${apiUrl}/api/greeting`)
  .then((response) => response.json())
  .then((body: { message: string; branch: string }) => {
    if (target) target.textContent = `${body.message} [${body.branch}]`;
  })
  .catch((error: unknown) => {
    if (target) target.textContent = `api error: ${String(error)}`;
  });
