FROM node:16

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./
COPY tsconfig*.json ./

RUN npm install
# If you are building your code for production
# RUN npm ci --only=production

# Bundle app source
COPY . .

RUN npm run build

RUN wget https://download.openzim.org/release/zim-tools/zim-tools_linux-x86_64-3.1.0.tar.gz
RUN tar xzvf zim-tools_linux-x86_64-3.1.0.tar.gz
RUN rm zim-tools_linux-x86_64-3.1.0.tar.gz

ENTRYPOINT ["sh","get-and-swarm-archive.sh"]

#CMD ["https://download.kiwix.org/zim/wikipedia/wikipedia_bm_all_maxi_2022-02.zim" "http://192.168.10.172:1633" "c749612363aa9f0345041e24b54e6d177285148ac78356a6b33e468d6b418995"]
