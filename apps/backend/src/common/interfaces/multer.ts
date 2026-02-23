// Interface simplificada para Multer.File, compatível com Node 24
export interface UploadedFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
  stream?: any;
  destination?: string;
  filename?: string;
  path?: string;
}

