interface ProviderAttributionProps {
  className?: string;
}

export function ProviderAttribution(
  { className = "" }: ProviderAttributionProps,
) {
  return (
    <span className={`provider-attribution ${className}`.trim()}>
      Game data and images provided by{" "}
      <a href="https://rawg.io/" target="_blank" rel="noopener noreferrer">
        RAWG
      </a>
    </span>
  );
}
