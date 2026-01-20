FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy all files
COPY . .

# Expose port
EXPOSE 8000

# Set environment variable
ENV PORT=8000

# Run the server
CMD ["node", "server.js"]
