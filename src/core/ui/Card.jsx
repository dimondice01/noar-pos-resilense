import React from 'react';
import { cn } from '../utils/cn';

export const Card = ({ children, className, ...props }) => {
  return (
    <div 
      className={cn(
        "bg-white rounded-2xl shadow-soft border border-sys-200 p-6", // Estilo base
        className
      )} 
      {...props}
    >
      {children}
    </div>
  );
};