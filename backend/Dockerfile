FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/archdrift ./cmd/archdrift

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/archdrift /usr/local/bin/archdrift
USER nobody
EXPOSE 8080
ENTRYPOINT ["archdrift"]
