export type SchemaSource = 'json-ld' | 'microdata' | 'rdfa';

export interface TreeNode {
  id: string;
  label: string;
  type: 'object' | 'array' | 'field';
  source: SchemaSource;
  value?: string | number | boolean;
  children: TreeNode[];
  meta?: {
    path: string;
    schemaType?: string;
    idRef?: string;
  };
}
