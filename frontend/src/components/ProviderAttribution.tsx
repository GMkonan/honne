interface ProviderAttributionProps {
  className?: string;
}

export function ProviderAttribution(
  { className = "" }: ProviderAttributionProps,
) {
  return (
    <span className={`provider-attribution ${className}`.trim()}>
      Game data &amp; images:{"  "}
      <a href="https://rawg.io/" target="_blank" rel="noopener noreferrer">
        RAWG
      </a>
    </span>
  );
}
