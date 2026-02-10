import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Storage } from '@google-cloud/storage';

@Injectable()
export class GoogleCloudStorageService {
  private readonly storage: Storage;
  private readonly bucketName: string;
  private readonly logger = new Logger(GoogleCloudStorageService.name);

  constructor() {
    if (!process.env.GOOGLE_CLOUD_KEY_JSON_B64) {
      throw new Error('Missing GOOGLE_CLOUD_KEY_JSON_B64 env var.');
    }
    if (!process.env.GOOGLE_CLOUD_PROJECT_ID) {
      throw new Error('Missing GOOGLE_CLOUD_PROJECT_ID env var.');
    }
    if (!process.env.GOOGLE_CLOUD_BUCKET_NAME) {
      throw new Error('Missing GOOGLE_CLOUD_BUCKET_NAME env var.');
    }
    this.storage = new Storage({
      credentials: JSON.parse(
        Buffer.from(process.env.GOOGLE_CLOUD_KEY_JSON_B64, 'base64').toString(
          'utf-8',
        ),
      ),
      projectId: process.env.GOOGLE_CLOUD_PROJECT_ID,
    });
    this.bucketName = process.env.GOOGLE_CLOUD_BUCKET_NAME;
  }

  async uploadFile(file: Express.Multer.File): Promise<string> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      this.logger.warn(`📂 File is missing or empty: ${file?.originalname}`);
      throw new InternalServerErrorException(
        'Uploaded file is empty or corrupted',
      );
    }
    const bucket = this.storage.bucket(this.bucketName);
    const blob = bucket.file(`${Date.now()}-${file.originalname}`);
    const stream = blob.createWriteStream({
      resumable: false,
      contentType: file.mimetype,
    });

    return new Promise((resolve, reject) => {
      let hasError = false;

      stream.on('error', (err) => {
        hasError = true;
        this.logger.error(
          `🚨 Stream error for file ${file.originalname}:`,
          err,
        );
        reject(
          new InternalServerErrorException(
            'Failed to upload file to Google Cloud',
          ),
        );
      });

      stream.on('finish', async () => {
        if (hasError) return; // Evitar continuar si ya falló
        try {
          await blob.makePublic();
          const url = `https://storage.googleapis.com/${this.bucketName}/${blob.name}`;
          this.logger.log(`✅ File uploaded: ${url}`);
          resolve(url);
        } catch (err) {
          this.logger.error('🚨 Failed to make file public:', err);
          reject(
            new InternalServerErrorException(
              'Failed to make uploaded file public',
            ),
          );
        }
      });

      try {
        stream.end(file.buffer);
      } catch (err) {
        this.logger.error('❌ Error ending stream:', err);
        reject(
          new InternalServerErrorException('Failed to finalize file upload'),
        );
      }
    });
  }
  async deleteFile(fileUrl: string): Promise<void> {
    const fileName = fileUrl.split('/').pop(); // Extraer el nombre del archivo desde la URL
    if (!fileName) throw new Error('Invalid file URL');

    const isDefaultPhoto =
      fileUrl.includes('defaultPhotos') || fileName === 'ProductDefault.png';

    if (isDefaultPhoto) {
      console.log(`🛑 Skipping deletion: ${fileName} is a default image`);
      return;
    }

    const bucket = this.storage.bucket(this.bucketName);
    try {
      await bucket.file(fileName).delete();
    } catch (error: any) {
      // Si no existe, simplemente logueamos y seguimos
      if (error.code === 404) {
        console.warn(`⚠️ Archivo no encontrado en GCP: ${fileName}`);
      } else {
        throw error;
      }
    }
  }

  async deleteFiles(fileUrls: string[]): Promise<void> {
    const deletions = fileUrls.map((url) => this.deleteFile(url));
    await Promise.all(deletions);
  }
}
