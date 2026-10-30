const NotFound = () => {
  return (
    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-white/20 bg-white/10 backdrop-blur-lg">
      <div className="text-center">
        <div className="text-5xl font-bold text-white/80 [text-shadow:0_2px_8px_rgba(0,0,0,0.4)]">404</div>
        <div className="mt-2 text-sm text-white/60">页面不存在</div>
      </div>
    </div>
  );
};

export default NotFound;
