import React from "react";

type Props = {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  cta?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
  className?: string;
};

export default function EmptyState({ icon, title, description, cta, className = "" }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center py-16 px-6 text-center ${className}`}
    >
      {icon && (
        <div className="w-10 h-10 text-gray-300 mb-3 flex items-center justify-center">
          {icon}
        </div>
      )}
      <p className="text-base font-semibold text-gray-700 mb-1">{title}</p>
      {description && (
        <p className="text-sm text-gray-400 max-w-xs">{description}</p>
      )}
      {cta && (
        <div className="mt-4">
          {cta.href ? (
            <a
              href={cta.href}
              className="text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
            >
              {cta.label}
            </a>
          ) : (
            <button
              type="button"
              onClick={cta.onClick}
              className="text-sm font-medium text-amber-600 hover:text-amber-700 transition-colors"
            >
              {cta.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
