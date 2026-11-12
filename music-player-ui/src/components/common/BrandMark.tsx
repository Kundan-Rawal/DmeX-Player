import { BRAND } from '../../config/brand';

export function BrandMark({ className = '' }: { className?: string }) {
  return <img className={'app-brand-mark ' + className} src={BRAND.logo}
    width={32} height={32} alt="" aria-hidden="true" draggable={false} />;
}
