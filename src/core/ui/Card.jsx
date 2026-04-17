import React from 'react';
import { cn } from '../utils/cn';

export const Card = ({ children, className, variant = 'default', ...props }) => {
  const variants = {
    default:  "bg-surface-base border border-border-subtle shadow-card",
    elevated: "bg-surface-raised border border-border-subtle shadow-float",
    flat:     "bg-surface-overlay border border-border-subtle",
  };

  return (
    <div
      className={cn("rounded-card p-6", variants[variant], className)}
      {...props}
    >
      {children}
    </div>
  );
};