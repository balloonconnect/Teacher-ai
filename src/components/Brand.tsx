import { BRAND } from '../../shared/brand';

/** The Karkai AI robot-and-book mark (public/logo-mark.png). */
export const BrandMark = ({ size = 40 }: { size?: number }) => <img className="brandmark" src="/logo-mark.png" alt="" width={size} height={size} />;

/** "Karkai" in brand navy, "AI" in brand green. */
export const BrandName = ({ size = 16 }: { size?: number }) => {
  const [first, ...rest] = BRAND.appName.split(' ');
  return <b className="brandname" style={{ fontSize: size }}>{first} <span className="ai">{rest.join(' ')}</span></b>;
};
