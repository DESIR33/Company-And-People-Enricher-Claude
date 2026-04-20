"use client";

import { Loader2 } from "lucide-react";

const Star = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 784.11 815.53"
    className="w-full h-auto fill-[#C15F3C]"
  >
    <path d="M392.05 0c-20.9,210.08-184.06,378.41-392.05,407.78 207.96,29.37 371.12,197.68 392.05,407.74 20.93-210.06 184.09-378.37 392.05-407.74-207.98-29.38-371.16-197.69-392.06-407.78z" />
  </svg>
);

interface StarButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
}

export function StarButton({ onClick, disabled, loading, label }: StarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="
        group relative px-[35px] py-[12px]
        text-[15px] font-semibold
        text-[#181818]
        bg-[#C15F3C]
        border-[3px] border-[#C15F3C]
        rounded-lg
        shadow-[0_0_0_#C15F3C8c]
        transition-all duration-300 ease-in-out
        cursor-pointer
        hover:bg-transparent hover:text-[#C15F3C] hover:shadow-[0_0_25px_#C15F3C8c]
        active:scale-95
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#C15F3C] disabled:hover:text-[#181818] disabled:hover:shadow-none
      "
    >
      <span className="relative z-10 flex items-center gap-2 text-white group-hover:text-[#C15F3C] transition-colors duration-300">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        {label}
      </span>

      {/* Star 1 */}
      <div className="absolute top-[20%] left-[20%] w-[25px] z-[-5] transition-all duration-[1000ms] ease-[cubic-bezier(0.05,0.83,0.43,0.96)] drop-shadow-[0_0_0] group-hover:top-[-80%] group-hover:left-[-30%] group-hover:drop-shadow-[0_0_10px_#C15F3C] group-hover:z-[2]">
        <Star />
      </div>

      {/* Star 2 */}
      <div className="absolute top-[45%] left-[45%] w-[15px] z-[-5] transition-all duration-[1000ms] ease-[cubic-bezier(0,0.4,0,1.01)] drop-shadow-[0_0_0] group-hover:top-[-25%] group-hover:left-[10%] group-hover:drop-shadow-[0_0_10px_#C15F3C] group-hover:z-[2]">
        <Star />
      </div>

      {/* Star 3 */}
      <div className="absolute top-[40%] left-[40%] w-[5px] z-[-5] transition-all duration-[1000ms] ease-[cubic-bezier(0,0.4,0,1.01)] drop-shadow-[0_0_0] group-hover:top-[55%] group-hover:left-[25%] group-hover:drop-shadow-[0_0_10px_#C15F3C] group-hover:z-[2]">
        <Star />
      </div>

      {/* Star 4 */}
      <div className="absolute top-[20%] left-[40%] w-[8px] z-[-5] transition-all duration-[800ms] ease-[cubic-bezier(0,0.4,0,1.01)] drop-shadow-[0_0_0] group-hover:top-[30%] group-hover:left-[80%] group-hover:drop-shadow-[0_0_10px_#C15F3C] group-hover:z-[2]">
        <Star />
      </div>

      {/* Star 5 */}
      <div className="absolute top-[25%] left-[45%] w-[15px] z-[-5] transition-all duration-[600ms] ease-[cubic-bezier(0,0.4,0,1.01)] drop-shadow-[0_0_0] group-hover:top-[25%] group-hover:left-[115%] group-hover:drop-shadow-[0_0_10px_#C15F3C] group-hover:z-[2]">
        <Star />
      </div>

      {/* Star 6 */}
      <div className="absolute top-[5%] left-[50%] w-[5px] z-[-5] transition-all duration-[800ms] ease-in-out drop-shadow-[0_0_0] group-hover:top-[5%] group-hover:left-[60%] group-hover:drop-shadow-[0_0_10px_#C15F3C] group-hover:z-[2]">
        <Star />
      </div>
    </button>
  );
}
