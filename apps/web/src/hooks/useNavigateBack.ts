import { useCanGoBack, useNavigate } from "@tanstack/react-router";

/** Returns to the previous app page, or home when opened without app history. */
export function useNavigateBack() {
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();

  return () => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void navigate({ to: "/" });
  };
}
