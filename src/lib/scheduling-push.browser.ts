import { deviceCapability, PUSH_ORIGIN } from './scheduling-push';

export function readPushCapability() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const permission = 'Notification' in window ? Notification.permission : 'unavailable';
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  return { ios, installed, permission, supported, state: deviceCapability({ secure: window.isSecureContext, supported, ios, installed, permission }),
    publishedOrigin: window.location.origin === PUSH_ORIGIN && window.self === window.top };
}

export async function currentPushSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration?.active?.scriptURL.endsWith('/hub-push-sw.js')) return null;
  return registration.pushManager.getSubscription();
}

export async function enablePushDevice(publicKey: string) {
  const cap = readPushCapability();
  if (cap.state !== 'ready' || !cap.publishedOrigin) throw new Error('Open the published Hub from its Home Screen icon to enable notifications');
  // Called directly by a user tap before registration/network awaits (iOS requirement).
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications were not allowed. Check your device notification settings');
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing && !existing.active?.scriptURL.endsWith('/hub-push-sw.js')) throw new Error('Another notification worker is installed; contact the Hub administrator');
  await navigator.serviceWorker.register('/hub-push-sw.js', { scope: '/', updateViaCache: 'none' });
  const ready = await navigator.serviceWorker.ready;
  const raw = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  return (await ready.pushManager.getSubscription()) ?? ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: raw });
}