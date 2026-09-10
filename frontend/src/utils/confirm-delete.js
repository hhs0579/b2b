export function formatImpactLines(references = {}, labels = {}) {
  return Object.entries(references)
    .filter(([, value]) => typeof value === "number" && value > 0)
    .map(([key, value]) => `${labels[key] || key} ${value}건`);
}

export function confirmHardDelete(intro) {
  const first = window.confirm(intro);
  if (!first) {
    return false;
  }
  return window.confirm("정말 완전히 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.");
}

export function blockedDeleteMessage(title, references, labels) {
  const lines = formatImpactLines(references, labels);
  return [title, "", ...lines, "", "대신 비활성화를 사용하세요."].join("\n");
}
