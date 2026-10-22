export interface ToastItem {
  id: number;
  message: string;
  type: "default" | "success";
}

export function ToastViewport({ items }: { items: ToastItem[] }) {
  return (
    <div className="toast-wrap" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.type === "success" ? "success" : ""}`}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
