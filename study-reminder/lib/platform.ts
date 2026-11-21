/** Android Chrome / PWA environment helpers (client-only). */

export type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function isChromeFamily(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // Exclude Edge/Opera/Samsung if we want pure Chrome; for install UX include Chromium Android
  return /Chrome|CriOS|EdgA|SamsungBrowser/i.test(ua) && !/OPR\//i.test(ua);
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  const ios = "standalone" in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mq || !!ios;
}

export function androidInstallHint(): string {
  return "Android Chrome：点右上角 ⋮ →「安装应用」或「添加到主屏幕」。若出现应用内「安装到主屏幕」按钮，点它即可。";
}
