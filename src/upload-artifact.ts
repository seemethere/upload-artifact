import * as core from '@actions/core'
import * as github from '@actions/github'
import * as AWS from 'aws-sdk'
import * as fs from 'fs'
import {findFilesToUpload} from './search'
import {getInputs} from './input-helper'
import {NoFileOptions} from './constants'

async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const searchResult = await findFilesToUpload(inputs.searchPath)
    if (searchResult.filesToUpload.length === 0) {
      // No files were found, different use cases warrant different types of behavior if nothing is found
      switch (inputs.ifNoFilesFound) {
        case NoFileOptions.warn: {
          core.warning(
            `No files were found with the provided path: ${inputs.searchPath}. No artifacts will be uploaded.`
          )
          break
        }
        case NoFileOptions.error: {
          core.setFailed(
            `No files were found with the provided path: ${inputs.searchPath}. No artifacts will be uploaded.`
          )
          break
        }
        case NoFileOptions.ignore: {
          core.info(
            `No files were found with the provided path: ${inputs.searchPath}. No artifacts will be uploaded.`
          )
          break
        }
      }
    } else {
      const s3 = new AWS.S3({region: inputs.region})
      const s3Prefix = `${github.context.repo.owner}/${github.context.repo.repo}/${github.context.runId}/${inputs.artifactName}`
      const s = searchResult.filesToUpload.length === 1 ? '' : 's'
      core.info(
        `With the provided path, there will be ${searchResult.filesToUpload.length} file${s} uploaded`
      )
      core.debug(`Root artifact directory is ${searchResult.rootDirectory} `)

      if (searchResult.filesToUpload.length > 10000) {
        core.warning(
          `There are over 10, 000 files in this artifact, consider create an archive before upload to improve the upload performance.`
        )
      }
      const retentionDays = inputs.retentionDays ? inputs.retentionDays : 90
      const today = new Date()
      const expirationDate = new Date(today)
      expirationDate.setDate(expirationDate.getDate() + retentionDays)
      for (const fileName of searchResult.filesToUpload) {
        core.debug(
          JSON.stringify({rootDirectory: searchResult.rootDirectory, fileName})
        )
        // Add trailing / to root directory to solve issues where root directory doesn't
        // look to be relative
        const relativeName = fileName.replace(
          `${searchResult.rootDirectory}/`,
          ''
        )
        const s3Key = `${s3Prefix}/${relativeName}`
        const s3Params = {
          Bucket: inputs.s3Bucket,
          Key: s3Key,
          Body: fs.readFileSync(fileName),
          Expires: expirationDate
        }
        core.debug(`s3Params: ${JSON.stringify(s3Params)}`)
        core.info(`Starting upload of ${relativeName}`)
        await s3
          .putObject(s3Params, err => {
            if (err) {
              core.error(`Error uploading file ${relativeName}, ${err}`)
              throw err
            } else {
              core.info(
                `Done uploading ${relativeName}, expires ${expirationDate}`
              )
            }
          })
          .promise()
      }
    }
  } catch (err) {
    core.setFailed(err.message)
  }
}

run()
