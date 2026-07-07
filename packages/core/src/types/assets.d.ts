// Bun 텍스트 임포트(with { type: "text" }) 타입 선언
declare module "*.csv" {
  const text: string;
  export default text;
}
