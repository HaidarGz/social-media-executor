# Use the official Playwright image which has all browser dependencies
FROM mcr.microsoft.com/playwright:v1.58.2-jammy

# Set working directory
WORKDIR /app

# Install FFmpeg for the TikTok JPG-to-Video conversion
RUN apt-get update && apt-get install -y ffmpeg

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Create folders for temporary media and music
RUN mkdir -p tmp music

# Railway uses the PORT environment variable; we expose 3000 as a default
EXPOSE 3000

# Start the application
CMD ["node", "index.js"]
