import { useEffect, useState } from "react";

type ToastOptions = Record<string, unknown>;
type ToastId = string | number;
type SonnerModule = typeof import("sonner");

let sonnerPromise: Promise<SonnerModule> | null = null;

function loadSonner() {
  if (!sonnerPromise) sonnerPromise = import("sonner");
  return sonnerPromise;
}

function makeToastId() {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const toast = {
  success(message: string, options?: ToastOptions) {
    void loadSonner().then(({ toast }) => toast.success(message, options));
  },
  error(message: string, options?: ToastOptions) {
    void loadSonner().then(({ toast }) => toast.error(message, options));
  },
  loading(message: string, options?: ToastOptions): ToastId {
    const id = (options?.id as ToastId | undefined) ?? makeToastId();
    void loadSonner().then(({ toast }) => toast.loading(message, { ...options, id }));
    return id;
  },
  dismiss(id?: ToastId) {
    void loadSonner().then(({ toast }) => toast.dismiss(id));
  },
};

type ToasterProps = Record<string, unknown>;

const Toaster = ({ ...props }: ToasterProps) => {
  const [mounted, setMounted] = useState(false);
  const [Sonner, setSonner] = useState<SonnerModule["Toaster"] | null>(null);

  useEffect(() => {
    let active = true;
    loadSonner().then((mod) => {
      if (!active) return;
      setSonner(() => mod.Toaster);
      setMounted(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!mounted || !Sonner) return null;

  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...(props as React.ComponentProps<SonnerModule["Toaster"]>)}
    />
  );
};

export { Toaster };
